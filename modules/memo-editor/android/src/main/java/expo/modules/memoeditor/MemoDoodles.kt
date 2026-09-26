package expo.modules.memoeditor

import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.os.SystemClock
import android.text.Layout
import android.text.Spannable
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.view.Choreographer
import android.view.inputmethod.BaseInputConnection
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

private const val SPAN_FLAGS = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
private const val GRID_SIZE = 24f

/** 끝낸 할 일의 두들은 글씨처럼 흐리게 그린다. */
private const val CHECKED_ALPHA = 0.45f

/**
 * 두들이 붙은 낱말. 낱말 전체에 건다. 스팬 하나는 낱말 하나에만 쓴다. (낱말이 띄어쓰기로 나뉘면 앞 낱말에 남는다)
 * 낱말은 두들과 함께 칩으로 그린다.
 */
class MemoDoodleSpan(val id: String) {
  /** 칩이 나타난 정도(0-1). 나타나거나 사라지는 동안만 1보다 작다. */
  var progress = 1f
}

/** 두들 그림 한 겹. 좌표는 24x24 격자다. */
class DoodleLayer(
  val path: Path,
  val fill: Int?,
  val stroke: Int?,
  val width: Float,
  val opacity: Float,
  val dx: Float,
  val dy: Float
)

/** 두들 그림 하나와, 그 낱말을 감싸는 칩의 색 */
class DoodleArt(val layers: List<DoodleLayer>, val chipFill: Int)

/** 두들 그림들과 칩 치수. 편집기의 글자 크기를 따른다. (iOS와 같다) */
class DoodleRenderer(private val art: Map<String, DoodleArt>, private val theme: MemoTheme) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val chipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val rect = RectF()

  val isEmpty: Boolean get() = art.isEmpty()

  /** 쌓인 줄의 칩끼리 닿지 않도록 줄 간격 안에 들어가는 높이 */
  val chipHeightPx: Float get() = theme.px(ceil(theme.fontSize * 1.22f) + 2f)
  val doodleSizePx: Float get() = theme.px(theme.fontSize.roundToInt().toFloat())
  /** 칩 왼쪽 여백. 낱말 앞 띄어쓰기를 이만큼 넓힌다. */
  val padLeftPx: Float get() = theme.px((theme.fontSize * 0.28f).roundToInt().toFloat())
  /** 낱말과 두들 사이 */
  val innerGapPx: Float get() = theme.px((theme.fontSize * 0.17f).roundToInt().toFloat())
  val padRightPx: Float get() = theme.px((theme.fontSize * 0.28f).roundToInt().toFloat())
  /** 낱말 끝 글자 뒤에 비워 두는 자리 */
  val gapPx: Float get() = innerGapPx + doodleSizePx + padRightPx

  fun has(id: String) = art.containsKey(id)

  /**
   * 낱말(left부터 wordEnd까지)과 두들을 칩으로 그린다. progress는 칩이 나타난 정도다.
   * 글자보다 먼저 그리므로 낱말 글자는 칩 위에 보인다.
   */
  fun drawChip(canvas: Canvas, id: String, left: Float, wordEnd: Float, centerY: Float, progress: Float, dimmed: Boolean) {
    val art = art[id] ?: return
    if (progress <= 0f) return
    val open = MemoDoodles.opening(progress)
    val alpha = if (dimmed) CHECKED_ALPHA else 1f

    val half = chipHeightPx / 2f
    rect.set(left - padLeftPx * open, centerY - half, wordEnd + gapPx * open, centerY + half)
    chipPaint.color = art.chipFill
    chipPaint.alpha = (255 * alpha * min(1f, progress * 2.5f)).roundToInt()
    canvas.drawRoundRect(rect, half, half, chipPaint)

    val pop = MemoDoodles.popping(progress)
    if (pop <= 0f) return
    val size = doodleSizePx
    val centerX = wordEnd + innerGapPx * open + size / 2f
    val scale = MemoDoodles.easeOutBack(pop)
    // 겹친 선과 면이 따로 비치지 않도록 한 장으로 합쳐 흐리게 한다. (스티커 그림자가 칸 밖으로 조금 나간다)
    val margin = size * 0.1f
    val layerAlpha = (255 * alpha * min(1f, pop * 2f)).roundToInt()
    val saved = if (layerAlpha < 255) {
      canvas.saveLayerAlpha(
        centerX - size / 2f - margin, centerY - size / 2f - margin,
        centerX + size / 2f + margin, centerY + size / 2f + margin,
        layerAlpha
      )
    } else {
      canvas.save()
    }
    canvas.translate(centerX, centerY)
    canvas.scale(scale * size / GRID_SIZE, scale * size / GRID_SIZE)
    canvas.translate(-GRID_SIZE / 2f, -GRID_SIZE / 2f)
    for (layer in art.layers) {
      canvas.save()
      canvas.translate(layer.dx, layer.dy)
      val opacity = (255 * layer.opacity).roundToInt()
      layer.fill?.let {
        paint.style = Paint.Style.FILL
        paint.color = it
        paint.alpha = opacity
        canvas.drawPath(layer.path, paint)
      }
      layer.stroke?.let {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = layer.width
        paint.color = it
        paint.alpha = opacity
        canvas.drawPath(layer.path, paint)
      }
      canvas.restore()
    }
    canvas.restoreToCount(saved)
  }
}

/**
 * 낱말 끝 글자를 대신 그리며 뒤에 칩 자리를 만든다. 칩과 두들은 편집기가 글자보다 먼저 그린다.
 * ReplacementSpan에는 글자색·밑줄·취소선 스팬이 적용되지 않으므로 직접 입힌다.
 * exiting이면 두들을 뗀 뒤 사라지는 중인 자리다. (mark는 이미 글에 없다)
 */
class MemoDoodleGapSpan(private val renderer: DoodleRenderer, val mark: MemoDoodleSpan) : ReplacementSpan() {
  var exiting = false
  /** 끝 글자의 원래 폭. 칩의 오른쪽 끝을 여기서부터 잰다. */
  var textWidth = 0f
    private set
  /** 마지막으로 폭을 잰 진행도. 움직이는 동안 달라지면 문단을 다시 배치한다. */
  var measuredProgress = 1f
    private set

  override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    if (fm != null) paint.getFontMetricsInt(fm)
    textWidth = paint.measureText(text, start, end)
    measuredProgress = mark.progress
    return (textWidth + renderer.gapPx * MemoDoodles.opening(mark.progress)).roundToInt()
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint
  ) {
    val textPaint = TextPaint(paint)
    if (text is Spanned) {
      for (style in text.getSpans(start, end, CharacterStyle::class.java)) {
        if (style is MetricAffectingSpan) continue
        style.updateDrawState(textPaint)
      }
    }
    canvas.drawText(text, start, end, x, y.toFloat(), textPaint)
  }
}

/**
 * 두들 낱말 앞 띄어쓰기를 칩 왼쪽 여백만큼 넓힌다. 띄어쓰기는 그대로 띄어쓰기로 남아 줄바꿈 자리가 된다.
 * (ReplacementSpan으로 바꾸면 그 자리에서 줄이 나뉘지 않는다)
 */
class MemoDoodlePadSpan(private val renderer: DoodleRenderer, val gap: MemoDoodleGapSpan) : MetricAffectingSpan() {
  override fun updateMeasureState(paint: TextPaint) = widen(paint)

  // 한 줄을 그릴 때(TextLine)는 이쪽으로 폭을 잰다.
  override fun updateDrawState(paint: TextPaint) = widen(paint)

  private fun widen(paint: TextPaint) {
    val pad = renderer.padLeftPx * MemoDoodles.opening(gap.mark.progress)
    if (pad <= 0f) return
    val scale = paint.textScaleX
    paint.textScaleX = 1f
    val space = paint.measureText(" ")
    paint.textScaleX = if (space > 0f) (space + pad) / space else scale
  }
}

object MemoDoodles {
  // region Art

  fun parseArt(records: List<DoodleArtRecord>, theme: MemoTheme): DoodleRenderer =
    DoodleRenderer(
      records.associate { record ->
        record.id to DoodleArt(
          layers = record.ops.map { op ->
            DoodleLayer(
              path = parsePath(op.d),
              fill = color(op.fill),
              stroke = color(op.stroke),
              width = (op.width ?: 1.5).toFloat(),
              opacity = (op.opacity ?: 1.0).toFloat(),
              dx = (op.dx ?: 0.0).toFloat(),
              dy = (op.dy ?: 0.0).toFloat()
            )
          },
          chipFill = color(record.chipFill) ?: Color.rgb(0xF2, 0xF2, 0xF7)
        )
      },
      theme
    )

  /** '#RRGGBB' */
  private fun color(value: String?): Int? =
    try {
      value?.let { Color.parseColor(it) }
    } catch (error: IllegalArgumentException) {
      null
    }

  /** 절대 좌표의 M·L·C·Q·Z만 읽는다. (src/doodles/art.ts가 그렇게만 만든다) */
  fun parsePath(d: String): Path {
    val path = Path()
    var command = 'M'
    val values = ArrayList<Float>(6)
    val number = StringBuilder()

    fun apply() {
      when {
        command == 'M' && values.size == 2 -> {
          path.moveTo(values[0], values[1])
          command = 'L' // M 뒤에 이어지는 점은 L로 읽는다.
        }
        command == 'L' && values.size == 2 -> path.lineTo(values[0], values[1])
        command == 'Q' && values.size == 4 -> path.quadTo(values[0], values[1], values[2], values[3])
        command == 'C' && values.size == 6 -> path.cubicTo(values[0], values[1], values[2], values[3], values[4], values[5])
        else -> return
      }
      values.clear()
    }

    fun flush() {
      number.toString().toFloatOrNull()?.let {
        values.add(it)
        apply()
      }
      number.clear()
    }

    for (char in d) {
      when (char) {
        'M', 'L', 'C', 'Q' -> {
          flush()
          command = char
          values.clear()
        }
        'Z' -> {
          flush()
          path.close()
          values.clear()
        }
        '-' -> {
          flush()
          number.append(char)
        }
        in '0'..'9', '.' -> number.append(char)
        else -> flush()
      }
    }
    flush()
    return path
  }

  // endregion

  // region Layout

  /** start에서 처음 나오는 공백 아닌 글자가 속한 낱말(띄어쓰기 사이). end는 포함하지 않는다. */
  private fun word(text: CharSequence, start: Int, end: Int): IntRange? {
    var location = start
    while (location < end && text[location].isWhitespace()) location++
    if (location >= end) return null
    var wordStart = location
    while (wordStart > 0 && !text[wordStart - 1].isWhitespace()) wordStart--
    var wordEnd = location
    while (wordEnd < text.length && !text[wordEnd].isWhitespace()) wordEnd++
    return wordStart until wordEnd
  }

  /** 두들이 붙은 낱말들 (문서 순서). 표시가 낱말 일부에만 걸려 있어도 낱말 전체를 돌려준다. */
  fun words(text: Spanned): List<Pair<IntRange, MemoDoodleSpan>> {
    val result = ArrayList<Pair<IntRange, MemoDoodleSpan>>()
    val usedWords = HashSet<Int>()
    val marks = text.getSpans(0, text.length, MemoDoodleSpan::class.java).sortedBy { text.getSpanStart(it) }
    for (mark in marks) {
      val word = word(text, text.getSpanStart(mark), text.getSpanEnd(mark)) ?: continue
      if (usedWords.add(word.first)) result.add(word to mark)
    }
    return result
  }

  fun hasMark(text: Spanned, start: Int, end: Int): Boolean =
    text.getSpans(start, end, MemoDoodleSpan::class.java).any {
      text.getSpanStart(it) < end && text.getSpanEnd(it) > start
    }

  /** 낱말 끝 글자(서로게이트 쌍이면 두 칸) */
  private fun lastCharacter(text: CharSequence, word: IntRange): IntRange {
    val end = word.last + 1
    val start = if (end - 2 >= word.first && Character.isLowSurrogate(text[end - 1]) &&
      Character.isHighSurrogate(text[end - 2])
    ) end - 2 else end - 1
    return start until end
  }

  /**
   * 두들 표시를 낱말 전체로 맞추고(고쳐 쓰거나 이어 쓴 글자까지), 낱말마다 끝 글자에 칩 자리 스팬을,
   * 앞 띄어쓰기에 여백 스팬을 둔다. renderer가 없거나 비어 있으면 자리를 모두 뺀다. 두들이 없는 문서에서는 아무것도 바꾸지 않는다.
   * 한글 조합 중인 낱말은 건드리지 않고, 조합이 끝난 뒤(다음 편집이나 커서 이동) 맞춘다.
   * force면 크기가 바뀌었을 수 있으니 자리 스팬을 모두 새로 단다. 사라지는 중인 자리는 다 사라질 때까지 둔다.
   */
  fun layout(text: Spannable, renderer: DoodleRenderer?, force: Boolean = false) {
    val marks = text.getSpans(0, text.length, MemoDoodleSpan::class.java)
    val gaps = text.getSpans(0, text.length, MemoDoodleGapSpan::class.java)
    val pads = text.getSpans(0, text.length, MemoDoodlePadSpan::class.java)
    if (marks.isEmpty() && gaps.isEmpty() && pads.isEmpty()) return

    val composingStart = BaseInputConnection.getComposingSpanStart(text)
    val composingEnd = BaseInputConnection.getComposingSpanEnd(text)
    fun composing(range: IntRange) =
      composingStart != -1 && range.first < composingEnd && range.last + 1 > composingStart

    val words = words(text)
    val claimed = words.map { it.second }.toSet()
    val settled = words.filter { !composing(it.first) }

    // 표시: 조합 중이 아닌 낱말마다 표시 하나가 낱말 전체를 덮게 하고, 쓰이지 않은 표시는 뗀다.
    for (mark in marks) {
      if (mark !in claimed && !composing(text.getSpanStart(mark) until text.getSpanEnd(mark))) text.removeSpan(mark)
    }
    for ((word, mark) in settled) {
      if (text.getSpanStart(mark) != word.first || text.getSpanEnd(mark) != word.last + 1) {
        text.setSpan(mark, word.first, word.last + 1, SPAN_FLAGS)
      }
    }

    // 자리: 낱말 끝 글자에 하나씩. 조합 중인 낱말의 자리는 조합이 끝날 때까지 제자리에 둔다.
    // (자리가 사라졌다 다시 생기면 치는 동안 글이 흔들린다)
    if (renderer == null || renderer.isEmpty) {
      gaps.forEach { text.removeSpan(it) }
      pads.forEach { text.removeSpan(it) }
      return
    }
    val wanted = settled.filter { renderer.has(it.second.id) }.associate { lastCharacter(text, it.first) to it.second }
    val kept = HashSet<IntRange>()
    for (gap in gaps) {
      val range = text.getSpanStart(gap) until text.getSpanEnd(gap)
      val keep = when {
        gap.exiting -> !force && gap.mark.progress > 0f
        word(text, range.first, range.last + 1)?.let { composing(it) } == true -> true
        else -> !force && wanted[range] === gap.mark && kept.add(range)
      }
      if (!keep) text.removeSpan(gap)
    }
    for ((range, mark) in wanted) {
      if (range !in kept) text.setSpan(MemoDoodleGapSpan(renderer, mark), range.first, range.last + 1, SPAN_FLAGS)
    }

    // 여백: 자리마다 그 낱말 앞 띄어쓰기에 하나씩 (줄바꿈이나 문단 첫머리면 없다)
    val wantedPads = HashMap<Int, MemoDoodleGapSpan>()
    for (gap in text.getSpans(0, text.length, MemoDoodleGapSpan::class.java)) {
      val word = word(text, text.getSpanStart(gap), text.getSpanEnd(gap)) ?: continue
      val lead = word.first - 1
      if (lead >= 0 && text[lead].isWhitespace() && text[lead] != '\n') wantedPads[lead] = gap
    }
    val keptPads = HashSet<Int>()
    for (pad in pads) {
      val at = text.getSpanStart(pad)
      val keep = !force && text.getSpanEnd(pad) == at + 1 && wantedPads[at] === pad.gap && keptPads.add(at)
      if (!keep) text.removeSpan(pad)
    }
    for ((at, gap) in wantedPads) {
      if (at !in keptPads) text.setSpan(MemoDoodlePadSpan(renderer, gap), at, at + 1, SPAN_FLAGS)
    }
  }

  /**
   * 움직이는 동안 폭이 바뀐 자리·여백 스팬을 제자리에 다시 달아 그 문단을 다시 배치하게 한다.
   * (스팬 객체의 폭만 바뀌면 글 배치가 알지 못한다)
   */
  fun remeasure(text: Spannable) {
    for (gap in text.getSpans(0, text.length, MemoDoodleGapSpan::class.java)) {
      if (gap.measuredProgress == gap.mark.progress) continue
      val start = text.getSpanStart(gap)
      val end = text.getSpanEnd(gap)
      text.setSpan(gap, start, end, SPAN_FLAGS)
      for (pad in text.getSpans(0, text.length, MemoDoodlePadSpan::class.java)) {
        if (pad.gap !== gap) continue
        text.setSpan(pad, text.getSpanStart(pad), text.getSpanEnd(pad), SPAN_FLAGS)
      }
    }
  }

  /** 두들을 뗀 낱말들에 사라지는 자리를 단다. 떼기 전 낱말 범위와 두들 이름을 받아, 사라지게 할 표시들을 돌려준다. */
  fun addGhosts(text: Spannable, renderer: DoodleRenderer?, words: List<Pair<IntRange, String>>): List<MemoDoodleSpan> {
    if (renderer == null || renderer.isEmpty) return emptyList()
    val ghosts = ArrayList<MemoDoodleSpan>()
    for ((word, id) in words) {
      if (word.last >= text.length || !renderer.has(id)) continue
      val last = lastCharacter(text, word)
      if (text.getSpans(last.first, last.last + 1, MemoDoodleGapSpan::class.java).isNotEmpty()) continue
      val mark = MemoDoodleSpan(id)
      val gap = MemoDoodleGapSpan(renderer, mark).apply { exiting = true }
      text.setSpan(gap, last.first, last.last + 1, SPAN_FLAGS)
      ghosts.add(mark)
    }
    return ghosts
  }

  // endregion

  // region Drawing

  /** 자리 스팬마다 낱말과 두들을 칩으로 그린다. 좌표는 글 배치(layout) 기준이다. 글자보다 먼저 부른다. */
  fun drawChips(canvas: Canvas, layout: Layout, text: Spanned, renderer: DoodleRenderer?, textSize: Float) {
    if (renderer == null || renderer.isEmpty) return
    val gaps = text.getSpans(0, text.length, MemoDoodleGapSpan::class.java)
    if (gaps.isEmpty()) return
    val visibleTop = canvas.clipBounds.top
    val visibleBottom = canvas.clipBounds.bottom
    for (gap in gaps) {
      val start = text.getSpanStart(gap)
      val end = text.getSpanEnd(gap)
      if (start < 0 || end > text.length) continue
      val line = layout.getLineForOffset(start)
      if (layout.getLineBottom(line) < visibleTop || layout.getLineTop(line) > visibleBottom) continue
      val word = word(text, start, end) ?: continue
      // 낱말이 줄에 걸쳐 나뉘었으면 끝 글자가 있는 줄의 처음부터 감싼다.
      val first = max(word.first, layout.getLineStart(line))
      val left = layout.getPrimaryHorizontal(first)
      val wordEnd = layout.getPrimaryHorizontal(start) + gap.textWidth
      // 체크박스처럼 글자의 가운데 높이에 맞춘다.
      val centerY = layout.getLineBaseline(line) - textSize * 0.36f
      val dimmed = text.getSpans(start, end, MemoCheckedColorSpan::class.java).isNotEmpty()
      // 자리 폭을 잰 진행도로 그려야 칩 끝이 다음 글자와 맞는다.
      renderer.drawChip(canvas, gap.mark.id, left, wordEnd, centerY, gap.measuredProgress, dimmed)
    }
  }

  // endregion

  // region Easing

  /** 칩이 벌어진 정도. 나타나는 시간의 앞 60% 동안 벌어진다. */
  fun opening(t: Float): Float = easeInOut(t / 0.6f)

  /** 두들이 튀어 오른 정도. 칩이 거의 벌어졌을 때부터 나타나 칩 밖으로 넘치지 않는다. */
  fun popping(t: Float): Float = ((t - 0.35f) / 0.65f).coerceIn(0f, 1f)

  private fun easeInOut(value: Float): Float {
    val t = value.coerceIn(0f, 1f)
    return if (t < 0.5f) 4f * t * t * t else 1f - (-2f * t + 2f).pow(3) / 2f
  }

  /** 끝에서 살짝 넘쳤다가 돌아온다. */
  fun easeOutBack(t: Float): Float {
    val c1 = 1.70158f
    val c3 = c1 + 1f
    return 1f + c3 * (t - 1f).pow(3) + c1 * (t - 1f).pow(2)
  }

  // endregion
}

/**
 * 두들 칩이 나타나고 사라지는 움직임. 표시마다 진행도(progress)를 시간에 맞춰 바꾸고, 프레임마다 onFrame을 부른다.
 * 편집기는 onFrame에서 스팬 폭과 그림만 다시 잰다. 문서(표시)는 바꾸지 않아 되돌리기 기록이 생기지 않는다.
 */
class MemoDoodleAnimator(private val onFrame: (done: Boolean) -> Unit) {
  private class Entry(val mark: MemoDoodleSpan, val start: Long, val exiting: Boolean)

  private val entries = ArrayList<Entry>()
  private var running = false
  private val frameCallback = Choreographer.FrameCallback { tick() }

  val isRunning: Boolean get() = running

  /** 새로 붙은 두들을 차례로 나타나게 한다. (문서 순서로 넘긴다) */
  fun enter(marks: List<MemoDoodleSpan>) {
    if (!isEnabled || marks.isEmpty()) return
    val now = SystemClock.uptimeMillis()
    val step = step(marks.size)
    marks.forEachIndexed { index, mark ->
      mark.progress = 0f
      entries.add(Entry(mark, now + index * step, exiting = false))
    }
    start()
  }

  /** 뗀 두들을 차례로 사라지게 한다. 움직이지 않을 때는 바로 사라진 것으로 둔다. (다음 배치에서 자리를 뗀다) */
  fun exit(marks: List<MemoDoodleSpan>) {
    if (!isEnabled) {
      marks.forEach { it.progress = 0f }
      return
    }
    if (marks.isEmpty()) return
    val now = SystemClock.uptimeMillis()
    val step = step(marks.size) / 2
    marks.forEachIndexed { index, mark ->
      mark.progress = 1f
      entries.add(Entry(mark, now + index * step, exiting = true))
    }
    start()
  }

  /** 움직이던 것을 끝 상태로 만든다. (나타나던 것은 다 나타나고, 사라지던 것은 바로 사라진다) */
  fun finish() {
    for (entry in entries) entry.mark.progress = if (entry.exiting) 0f else 1f
    entries.clear()
    if (running) {
      running = false
      Choreographer.getInstance().removeFrameCallback(frameCallback)
    }
  }

  private fun start() {
    if (running) return
    running = true
    Choreographer.getInstance().postFrameCallback(frameCallback)
  }

  private fun tick() {
    if (!running) return
    val now = SystemClock.uptimeMillis()
    val iterator = entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      val duration = if (entry.exiting) EXIT_MS else ENTER_MS
      val t = ((now - entry.start).toFloat() / duration).coerceIn(0f, 1f)
      entry.mark.progress = if (entry.exiting) 1f - t else t
      if (t >= 1f) iterator.remove()
    }
    val done = entries.isEmpty()
    if (done) running = false else Choreographer.getInstance().postFrameCallback(frameCallback)
    onFrame(done)
  }

  companion object {
    private const val ENTER_MS = 420L
    private const val EXIT_MS = 280L
    /** 여러 개가 나타날 때 하나씩 늦추는 시간. 몇 개든 모두 합쳐 MAX_STAGGER_MS를 넘지 않는다. */
    private const val STAGGER_MS = 60L
    private const val MAX_STAGGER_MS = 600L

    private fun step(count: Int): Long = if (count > 1) min(STAGGER_MS, MAX_STAGGER_MS / (count - 1)) else 0L

    /** 설정에서 애니메이션을 껐으면(애니메이션 배율 0) 움직이지 않고 바로 바꾼다. */
    val isEnabled: Boolean
      get() = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()
  }
}
