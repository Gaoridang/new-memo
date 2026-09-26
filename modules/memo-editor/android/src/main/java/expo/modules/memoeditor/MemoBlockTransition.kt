package expo.modules.memoeditor

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.text.Spannable
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.LineBackgroundSpan
import android.text.style.UpdateAppearance
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

private const val SPAN_FLAGS = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE

/**
 * 코드로 일반 문단을 체크박스로 바꿀 때(할 일 자동 변환, 붙여넣은 글 정리) 문단이 바뀌는 모습을 보여 준다.
 * 글자를 들여쓰기만큼 밀고, 체크박스를 띄우고, 글자 위로 빛을 훑는다. iOS의 MemoBlockTransition과 같은 시간과 곡선을 쓴다.
 * 줄은 바뀐 뒤 모습대로 먼저 나눠 두고 그리는 위치와 색만 바꾸므로, 끝나는 순간 달라 보이는 곳이 없다.
 */
class MemoBlockTransition private constructor(
  private val textView: TextView,
  private val text: Spannable,
  private val paragraph: Paragraph,
  private val effect: Appear,
  private val onFinish: (MemoBlockTransition) -> Unit
) {
  private val animator = ValueAnimator.ofFloat(0f, 1f)
  private var finished = false

  fun start() {
    effect.update(0f)
    effect.attach(text, paragraph)
    animator.duration = effect.duration.roundToLong()
    animator.interpolator = LinearInterpolator()
    animator.addUpdateListener { update(it.animatedFraction * effect.duration) }
    animator.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: Animator) = finish()
    })
    animator.start()
  }

  /** 애니메이션을 멈추고 문단을 바뀐 모습 그대로 둔다. 여러 번 불러도 된다. */
  fun finish() {
    if (finished) return
    finished = true
    animator.removeAllListeners()
    animator.cancel()
    val start = text.getSpanStart(effect.anchor)
    val end = text.getSpanEnd(effect.anchor)
    effect.detach(text)
    // 전환 중에 줄이 다시 나뉘었더라도 제 들여쓰기로 맞춘다.
    if (start >= 0 && textView.text === text) {
      MemoDocument.requestReflow(text, start, end)
    }
    textView.invalidate()
    onFinish(this)
  }

  /** start에서 시작하는 편집이 이 문단의 글자나 위치를 바꾸는지. 다음 줄을 쓰는 동안에는 애니메이션을 이어 간다. */
  fun isAffectedByEdit(start: Int): Boolean {
    val end = text.getSpanEnd(effect.anchor)
    return end <= 0 || start < end || (start == end && text[end - 1] != '\n')
  }

  /** start..end 구간이 전환 중인 문단과 겹치는지 */
  fun overlaps(start: Int, end: Int): Boolean {
    val spanStart = text.getSpanStart(effect.anchor)
    return spanStart < 0 || (spanStart < end && start < text.getSpanEnd(effect.anchor))
  }

  private fun update(time: Float) {
    if (finished) return
    val start = text.getSpanStart(effect.anchor)
    val end = text.getSpanEnd(effect.anchor)
    // 문단이 지워졌거나 문서가 바뀌었으면 그대로 끝낸다.
    if (start < 0 || textView.text !== text) {
      finish()
      return
    }
    effect.update(time)
    // 같은 스팬을 다시 걸면 TextView가 그 문단만 새로 그린다. 줄은 다시 나누지 않는다.
    text.setSpan(effect.anchor, start, end, SPAN_FLAGS)
  }

  /** 체크박스가 나타나고 빛이 지나가는 모습. 문단에 붙이는 스팬과 시간에 따른 모습을 맡는다. */
  private class Appear(
    private val span: MemoBlockSpan,
    private val theme: MemoTheme,
    private val lit: Boolean,
    textColor: Int,
    textLeft: Float,
    textRight: Float,
    glowTop: Float,
    glowBottom: Float
  ) {
    private val motion = MarkerMotion()

    // 빛은 체크박스 쪽에서 들어와 글자 끝을 지나 사라진다. (레이아웃 좌표)
    private val bandWidth = theme.px((theme.fontSize * 6).roundToInt().toFloat())
    private val startX = textLeft - bandWidth / 2f
    private val endX = textRight + bandWidth / 2f
    private val shineDuration = ((endX - startX) / theme.px(1f) / Timing.SHINE_SPEED * 1000f)
      .coerceIn(Timing.SHINE_MIN, Timing.SHINE_MAX)

    // 글자 위를 지나가는 빛. 띠 밖은 원래 글자색이다.
    private val band = run {
      val tint = blendColors(textColor, theme.accentColor, 0.6f)
      val core = blendColors(theme.accentColor, Color.WHITE, 0.45f)
      LinearGradient(
        -bandWidth / 2f,
        0f,
        bandWidth / 2f,
        0f,
        intArrayOf(textColor, tint, core, tint, textColor),
        floatArrayOf(0f, 0.22f, 0.5f, 0.78f, 1f),
        Shader.TileMode.CLAMP
      )
    }
    private val bandMatrix = Matrix()
    private val shimmer = ShimmerSpan(band)
    private val glow = GlowSpan(
      theme.accentColor,
      width = theme.px(((theme.fontSize * 6).roundToInt() * 1.4f).roundToInt().toFloat()),
      top = glowTop,
      bottom = glowBottom,
      radius = minOf(theme.px(8f), (glowBottom - glowTop) / 2f)
    )

    /** 문단을 덮는 스팬. 앞의 글자가 바뀌어도 문단 위치를 따라간다. */
    val anchor: Any get() = shimmer
    val duration = maxOf(
      Timing.SLIDE,
      Timing.MARKER_DELAY + maxOf(Spring.settling(Timing.MARKER_FROM_SCALE), Timing.LIT_HOLD + Timing.LIT_FADE),
      Timing.SHINE_DELAY + shineDuration
    )

    fun attach(text: Spannable, paragraph: Paragraph) {
      span.motion = motion
      text.setSpan(glow, paragraph.start, paragraph.end, SPAN_FLAGS)
      text.setSpan(shimmer, paragraph.start, paragraph.end, SPAN_FLAGS)
    }

    fun update(time: Float) {
      // 글자가 들여쓰기만큼 밀려난다.
      motion.indent = Curve.slide.at(time, Timing.SLIDE)

      // 체크박스가 통통 튀듯 커지며 나타나고, 잠깐 강조색으로 빛나다 제 색으로 돌아온다.
      val markerTime = time - Timing.MARKER_DELAY
      motion.scale = Spring.value(markerTime, Timing.MARKER_FROM_SCALE)
      motion.alpha = Curve.fadeIn.at(markerTime, Timing.MARKER_FADE)
      motion.lit = if (lit) 1f - ((markerTime - Timing.LIT_HOLD) / Timing.LIT_FADE).coerceIn(0f, 1f) else 0f

      // 빛 띠는 밀려나는 글자를 따라 움직이고, 뒤로 번지는 빛은 제자리를 지나간다.
      val shineTime = time - Timing.SHINE_DELAY
      val center = startX + (endX - startX) * Curve.shine.at(shineTime, shineDuration)
      val slide = (theme.listIndentPx * motion.indent).roundToInt() - theme.listIndentPx
      bandMatrix.setTranslate(center + slide, 0f)
      band.setLocalMatrix(bandMatrix)
      glow.centerX = center
      glow.alpha = glowAlpha(shineTime / shineDuration)
    }

    fun detach(text: Spannable) {
      text.removeSpan(shimmer)
      text.removeSpan(glow)
      if (span.motion === motion) span.motion = null
    }
  }

  companion object {
    /**
     * paragraph의 종류가 previous에서 block으로 방금 바뀌었을 때(줄은 새 들여쓰기로 이미 나뉜 상태) 전환을 만든다.
     * 일반 문단이 체크박스가 된 게 아니거나, 문단이 화면 밖이거나, 기기 설정에서 애니메이션을 껐으면 null
     */
    fun create(
      textView: TextView,
      text: Spannable,
      theme: MemoTheme,
      paragraph: Paragraph,
      previous: MemoBlock,
      block: MemoBlock,
      onFinish: (MemoBlockTransition) -> Unit
    ): MemoBlockTransition? {
      if (previous != MemoBlock.PARAGRAPH || !block.isCheckbox) return null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled()) return null
      val layout = textView.layout ?: return null
      if (paragraph.isEmpty || !textView.isShown) return null

      val firstLine = layout.getLineForOffset(paragraph.start)
      val lastLine = layout.getLineForOffset(paragraph.end - 1)
      val visibleTop = textView.scrollY - textView.totalPaddingTop
      if (layout.getLineBottom(lastLine) <= visibleTop || layout.getLineTop(firstLine) >= visibleTop + textView.height) {
        return null
      }

      val span = MemoDocument.blockSpans(text, paragraph).firstOrNull() ?: return null
      // 들여쓰기가 다 들어간 지금 위치로 글자 구간을 잰다. 글자는 들여쓰기가 끝나는 곳에서 시작한다.
      val gap = theme.px(3f)
      val effect = Appear(
        span,
        theme,
        lit = block == MemoBlock.CHECKBOX,
        textColor = if (block == MemoBlock.CHECKED) theme.mutedColor else theme.textColor,
        textLeft = layout.getParagraphLeft(firstLine).toFloat(),
        textRight = (firstLine..lastLine).maxOf { layout.getLineMax(it) },
        glowTop = layout.getLineTop(firstLine) - gap,
        glowBottom = layout.getLineBaseline(lastLine) + textView.paint.fontMetrics.descent + gap
      )
      return MemoBlockTransition(textView, text, paragraph, effect, onFinish)
    }
  }
}

/** 글자를 빛 띠 그라디언트로 칠한다. */
private class ShimmerSpan(private val shader: Shader) : CharacterStyle(), UpdateAppearance {
  override fun updateDrawState(paint: TextPaint) {
    paint.shader = shader
  }
}

/** 빛이 지나갈 때 글자 뒤로 옅게 번지는 빛. 문단을 덮는 둥근 띠를 줄마다 제 몫만 그린다. */
private class GlowSpan(
  accentColor: Int,
  private val width: Float,
  private val top: Float,
  private val bottom: Float,
  private val radius: Float
) : LineBackgroundSpan {
  var centerX = 0f
  var alpha = 0f
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val matrix = Matrix()
  private val rect = RectF()
  private val gradient = LinearGradient(
    -width / 2f,
    0f,
    width / 2f,
    0f,
    intArrayOf(withAlpha(accentColor, 0f), withAlpha(accentColor, 0.08f), withAlpha(accentColor, 0f)),
    null,
    Shader.TileMode.CLAMP
  )

  init {
    paint.shader = gradient
  }

  override fun drawBackground(
    canvas: Canvas,
    p: Paint,
    left: Int,
    right: Int,
    lineTop: Int,
    baseline: Int,
    lineBottom: Int,
    text: CharSequence,
    start: Int,
    end: Int,
    lineNumber: Int
  ) {
    if (alpha <= 0f || text !is Spanned) return
    // 첫 줄과 끝 줄은 위아래 여유까지 맡아, 줄끼리 겹쳐 그리지 않는다.
    val clipTop = if (start <= text.getSpanStart(this)) top else lineTop.toFloat()
    val clipBottom = if (end >= text.getSpanEnd(this)) bottom else lineBottom.toFloat()
    matrix.setTranslate(centerX, 0f)
    gradient.setLocalMatrix(matrix)
    paint.alpha = (alpha * 255).roundToInt()
    rect.set(centerX - width / 2f, top, centerX + width / 2f, bottom)
    canvas.save()
    canvas.clipRect(left.toFloat(), clipTop, right.toFloat(), clipBottom)
    canvas.drawRoundRect(rect, radius, radius, paint)
    canvas.restore()
  }
}

/** 빛 번짐의 불투명도. 빛이 들어오며 켜지고 빠져나가며 꺼진다. */
private fun glowAlpha(progress: Float): Float = when {
  progress <= 0f || progress >= 1f -> 0f
  progress < 0.15f -> progress / 0.15f
  progress <= 0.7f -> 1f
  else -> (1f - progress) / 0.3f
}

/** 전환 애니메이션 시간(ms)과 크기. iOS의 MemoBlockTransition과 같은 값을 쓴다. */
private object Timing {
  const val SLIDE = 420f
  const val MARKER_DELAY = 70f
  const val MARKER_FADE = 160f
  const val MARKER_FROM_SCALE = 0.4f
  const val LIT_HOLD = 180f
  const val LIT_FADE = 520f
  const val SHINE_DELAY = 110f
  const val SHINE_MIN = 560f
  const val SHINE_MAX = 950f

  /** 빛이 지나가는 빠르기 (dp/초) */
  const val SHINE_SPEED = 520f
}

/** iOS의 CASpringAnimation(질량 1, 강성 260, 감쇠 16)과 같은 스프링 */
private object Spring {
  private const val MASS = 1f
  private const val STIFFNESS = 260f
  private const val DAMPING = 16f
  private val decay = DAMPING / (2f * MASS)
  private val frequency = sqrt(STIFFNESS / MASS - decay * decay)

  /** time(ms) 동안 from에서 1로 가는 값. 1을 조금 넘었다 돌아온다. */
  fun value(time: Float, from: Float): Float {
    if (time <= 0f) return from
    val t = time / 1000f
    val offset = from - 1f
    return 1f + exp(-decay * t) * (offset * cos(frequency * t) + decay * offset / frequency * sin(frequency * t))
  }

  /** 흔들림이 보이지 않을 만큼 잦아드는 시간(ms) */
  fun settling(from: Float): Float = ln(abs(from - 1f) / 0.001f) / decay * 1000f
}

private object Curve {
  val slide = PathInterpolator(0.22f, 1f, 0.36f, 1f)
  val shine = PathInterpolator(0.45f, 0f, 0.55f, 1f)
  val fadeIn = PathInterpolator(0f, 0f, 0.58f, 1f)
}

/** 시작하고 time(ms)이 지났을 때 duration 동안 움직이는 값 (0..1) */
private fun PathInterpolator.at(time: Float, duration: Float): Float =
  getInterpolation((time / duration).coerceIn(0f, 1f))
