package expo.modules.memoeditor

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * 마지막 빈 줄에 목록을 켰을 때 넣는 폭 없는 문자.
 * Android는 글자가 없는 마지막 줄에 문단 스팬(들여쓰기, 마커)을 적용하지 않기 때문에 자리를 잡아 둔다.
 * 저장할 때는 빠진다.
 */
const val PLACEHOLDER = '​'

private const val SPAN_FLAGS = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE

/** 문단 종류. 체크된 체크박스는 별도 값으로 둔다. iOS의 MemoBlock과 같은 값을 쓴다. */
enum class MemoBlock(val raw: String) {
  PARAGRAPH("paragraph"),
  CHECKBOX("checkbox"),
  CHECKED("checked"),
  BULLET("bullet"),
  NUMBER("number");

  val isList: Boolean get() = this != PARAGRAPH
  val isCheckbox: Boolean get() = this == CHECKBOX || this == CHECKED

  /** 툴바와 JS에 알려 주는 종류. 체크된 항목도 체크박스로 본다. */
  val kind: MemoBlock get() = if (this == CHECKED) CHECKBOX else this

  /** 엔터로 새 줄을 만들 때 이어지는 종류 */
  val continuation: MemoBlock get() = if (this == CHECKED) CHECKBOX else this

  companion object {
    fun fromRaw(raw: String?): MemoBlock = entries.firstOrNull { it.raw == raw } ?: PARAGRAPH
  }
}

enum class InlineStyle {
  BOLD,
  UNDERLINE,
  STRIKETHROUGH;

  val spanClass: Class<out Any>
    get() = when (this) {
      BOLD -> MemoBoldSpan::class.java
      UNDERLINE -> MemoUnderlineSpan::class.java
      STRIKETHROUGH -> MemoStrikethroughSpan::class.java
    }

  fun createSpan(): Any = when (this) {
    BOLD -> MemoBoldSpan()
    UNDERLINE -> MemoUnderlineSpan()
    STRIKETHROUGH -> MemoStrikethroughSpan()
  }
}

data class InlineFlags(
  val bold: Boolean = false,
  val underline: Boolean = false,
  val strikethrough: Boolean = false
) {
  fun has(style: InlineStyle): Boolean = when (style) {
    InlineStyle.BOLD -> bold
    InlineStyle.UNDERLINE -> underline
    InlineStyle.STRIKETHROUGH -> strikethrough
  }

  fun with(style: InlineStyle, on: Boolean): InlineFlags = when (style) {
    InlineStyle.BOLD -> copy(bold = on)
    InlineStyle.UNDERLINE -> copy(underline = on)
    InlineStyle.STRIKETHROUGH -> copy(strikethrough = on)
  }
}

class MemoTheme(private val density: Float) {
  var fontSize = 18f
  var textColor = Color.rgb(0x1C, 0x1C, 0x1E)
  var mutedColor = Color.rgb(0xA1, 0xA1, 0xA6)
  var accentColor = Color.rgb(0x00, 0x7A, 0xFF)
  var placeholderColor = Color.rgb(0xB4, 0xB4, 0xBA)

  fun px(dp: Float): Float = dp * density

  val textSizePx: Float get() = px(fontSize)
  val lineHeightPx: Int get() = px(fontSize * 1.5f).roundToInt()
  val listIndentPx: Int get() = px((fontSize * 1.55f).roundToInt().toFloat()).roundToInt()
  val markerSizePx: Float get() = px(fontSize)
}

// 편집기가 만든 스팬만 골라 다루기 위해 전용 클래스를 쓴다. (IME, 맞춤법 스팬은 건드리지 않는다)
class MemoBoldSpan : StyleSpan(Typeface.BOLD)
class MemoUnderlineSpan : UnderlineSpan()
class MemoStrikethroughSpan : StrikethroughSpan()
class MemoCheckedColorSpan(color: Int) : ForegroundColorSpan(color)

/** 문단 하나를 덮는 스팬. 들여쓰기를 만들고 첫 줄 왼쪽에 체크박스, 글머리 기호, 번호를 그린다. */
class MemoBlockSpan(val block: MemoBlock, private val theme: MemoTheme) : LeadingMarginSpan {
  var number = 1
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()
  private val path = Path()

  override fun getLeadingMargin(first: Boolean): Int = if (block.isList) theme.listIndentPx else 0

  override fun drawLeadingMargin(
    canvas: Canvas,
    p: Paint,
    x: Int,
    dir: Int,
    top: Int,
    baseline: Int,
    bottom: Int,
    text: CharSequence,
    start: Int,
    end: Int,
    first: Boolean,
    layout: Layout?
  ) {
    if (!block.isList || !first) return
    if (text is Spanned && text.getSpanStart(this) != start) return

    val left = x.toFloat()
    val centerY = baseline - theme.textSizePx * 0.36f
    when (block) {
      MemoBlock.CHECKBOX, MemoBlock.CHECKED -> drawCheckbox(canvas, left, centerY)
      MemoBlock.BULLET -> {
        val radius = theme.px((theme.fontSize / 3f).roundToInt().toFloat()) / 2f
        paint.style = Paint.Style.FILL
        paint.color = theme.textColor
        canvas.drawCircle(left + theme.px(7f) + radius, centerY, radius, paint)
      }
      MemoBlock.NUMBER -> {
        val label = "$number."
        paint.style = Paint.Style.FILL
        paint.color = theme.textColor
        paint.textSize = theme.textSizePx
        paint.typeface = Typeface.DEFAULT
        paint.fontFeatureSettings = "tnum"
        val right = left + theme.listIndentPx - theme.px(8f)
        canvas.drawText(label, right - paint.measureText(label), baseline.toFloat(), paint)
      }
      MemoBlock.PARAGRAPH -> Unit
    }
  }

  private fun drawCheckbox(canvas: Canvas, left: Float, centerY: Float) {
    val size = theme.markerSizePx
    val boxLeft = left + theme.px(1f)
    rect.set(boxLeft, centerY - size / 2f, boxLeft + size, centerY + size / 2f)
    val radius = size * 0.28f
    if (block == MemoBlock.CHECKED) {
      paint.style = Paint.Style.FILL
      paint.color = theme.accentColor
      canvas.drawRoundRect(rect, radius, radius, paint)
      path.reset()
      path.moveTo(rect.left + size * 0.26f, rect.top + size * 0.52f)
      path.lineTo(rect.left + size * 0.43f, rect.top + size * 0.69f)
      path.lineTo(rect.left + size * 0.75f, rect.top + size * 0.33f)
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = theme.px(2f)
      paint.strokeCap = Paint.Cap.ROUND
      paint.strokeJoin = Paint.Join.ROUND
      paint.color = Color.WHITE
      canvas.drawPath(path, paint)
    } else {
      val inset = theme.px(0.75f)
      rect.inset(inset, inset)
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = theme.px(1.5f)
      paint.color = theme.mutedColor
      canvas.drawRoundRect(rect, radius, radius, paint)
    }
  }
}

/** 문단 범위. end는 끝 줄바꿈을 포함한다. 문서가 비었거나 줄바꿈으로 끝나면 길이 0인 빈 문단이 있다. */
data class Paragraph(val start: Int, val end: Int) {
  val isEmpty: Boolean get() = start == end
}

object MemoDocument {
  fun paragraphs(text: CharSequence): List<Paragraph> {
    val result = ArrayList<Paragraph>()
    var start = 0
    val length = text.length
    while (start < length) {
      var end = start
      while (end < length && text[end] != '\n') end++
      if (end < length) end++
      result.add(Paragraph(start, end))
      start = end
    }
    if (length == 0 || text[length - 1] == '\n') {
      result.add(Paragraph(length, length))
    }
    return result
  }

  fun paragraphAt(text: CharSequence, offset: Int): Paragraph {
    val position = offset.coerceIn(0, text.length)
    var start = position
    while (start > 0 && text[start - 1] != '\n') start--
    var end = position
    while (end < text.length && text[end] != '\n') end++
    if (end < text.length) end++
    return Paragraph(start, end)
  }

  /** 끝 줄바꿈을 뺀 내용의 끝 */
  fun contentEnd(text: CharSequence, paragraph: Paragraph): Int =
    if (paragraph.end > paragraph.start && text[paragraph.end - 1] == '\n') paragraph.end - 1 else paragraph.end

  /** 자리 표시 문자를 건너뛴, 눈에 보이는 문단 시작 위치 */
  fun visibleStart(text: CharSequence, paragraph: Paragraph): Int =
    if (paragraph.start < text.length && text[paragraph.start] == PLACEHOLDER) paragraph.start + 1 else paragraph.start

  fun hasVisibleContent(text: CharSequence, paragraph: Paragraph): Boolean {
    for (i in paragraph.start until contentEnd(text, paragraph)) {
      if (text[i] != PLACEHOLDER) return true
    }
    return false
  }

  fun blockSpans(text: Spanned, paragraph: Paragraph): List<MemoBlockSpan> {
    if (paragraph.isEmpty) return emptyList()
    return text.getSpans(paragraph.start, paragraph.end, MemoBlockSpan::class.java)
      .filter { text.getSpanEnd(it) > paragraph.start && text.getSpanStart(it) < paragraph.end }
      .sortedBy { text.getSpanStart(it) }
  }

  fun blockOf(text: Spanned, paragraph: Paragraph): MemoBlock =
    blockSpans(text, paragraph).firstOrNull()?.block ?: MemoBlock.PARAGRAPH

  fun flagsAt(text: Spanned, index: Int): InlineFlags {
    if (index < 0 || index >= text.length) return InlineFlags()
    fun covered(style: InlineStyle) = text.getSpans(index, index + 1, style.spanClass).any {
      text.getSpanStart(it) <= index && text.getSpanEnd(it) > index
    }
    return InlineFlags(
      bold = covered(InlineStyle.BOLD),
      underline = covered(InlineStyle.UNDERLINE),
      strikethrough = covered(InlineStyle.STRIKETHROUGH)
    )
  }

  /** 범위 안의 모든 글자(줄바꿈, 자리 표시 제외)에 걸린 서식 */
  fun commonFlags(text: Spanned, start: Int, end: Int): InlineFlags? {
    var result: InlineFlags? = null
    for (i in start until end) {
      if (text[i] == '\n' || text[i] == PLACEHOLDER) continue
      val flags = flagsAt(text, i)
      result = result?.let {
        InlineFlags(it.bold && flags.bold, it.underline && flags.underline, it.strikethrough && flags.strikethrough)
      } ?: flags
    }
    return result
  }

  /** start..end 구간의 한 가지 인라인 서식을 켜거나 끈다. 이웃한 같은 스팬과는 합친다. */
  fun setInline(text: Spannable, start: Int, end: Int, style: InlineStyle, on: Boolean) {
    if (start >= end) return
    for (span in text.getSpans(start, end, style.spanClass)) {
      val spanStart = text.getSpanStart(span)
      val spanEnd = text.getSpanEnd(span)
      if (spanEnd <= start || spanStart >= end) continue
      text.removeSpan(span)
      if (spanStart < start) text.setSpan(style.createSpan(), spanStart, start, SPAN_FLAGS)
      if (spanEnd > end) text.setSpan(style.createSpan(), end, spanEnd, SPAN_FLAGS)
    }
    if (!on) return

    var newStart = start
    var newEnd = end
    val lookStart = (start - 1).coerceAtLeast(0)
    val lookEnd = (end + 1).coerceAtMost(text.length)
    for (span in text.getSpans(lookStart, lookEnd, style.spanClass)) {
      val spanStart = text.getSpanStart(span)
      val spanEnd = text.getSpanEnd(span)
      if (spanEnd == start || spanStart == end) {
        newStart = minOf(newStart, spanStart)
        newEnd = maxOf(newEnd, spanEnd)
        text.removeSpan(span)
      }
    }
    text.setSpan(style.createSpan(), newStart, newEnd, SPAN_FLAGS)
  }

  fun applyInline(text: Spannable, start: Int, end: Int, flags: InlineFlags) {
    for (style in InlineStyle.entries) {
      setInline(text, start, end, style, flags.has(style))
    }
  }

  /** 문단 하나에 문단 종류 스팬을 맞춘다. 체크된 항목은 글자색도 흐리게 한다. */
  fun setBlock(text: Spannable, paragraph: Paragraph, block: MemoBlock, theme: MemoTheme, number: Int = 1) {
    if (paragraph.isEmpty) return
    val existing = blockSpans(text, paragraph)
    val keep = existing.singleOrNull()?.takeIf {
      it.block == block && text.getSpanStart(it) == paragraph.start && text.getSpanEnd(it) == paragraph.end
    }
    if (keep == null) {
      existing.forEach { text.removeSpan(it) }
      if (block.isList) {
        text.setSpan(MemoBlockSpan(block, theme).also { it.number = number }, paragraph.start, paragraph.end, SPAN_FLAGS)
      }
    } else {
      keep.number = number
    }

    val colorSpans = text.getSpans(paragraph.start, paragraph.end, MemoCheckedColorSpan::class.java)
    val colorOk = block == MemoBlock.CHECKED && colorSpans.size == 1 &&
      text.getSpanStart(colorSpans[0]) == paragraph.start && text.getSpanEnd(colorSpans[0]) == paragraph.end
    if (!colorOk) {
      colorSpans.forEach { text.removeSpan(it) }
      if (block == MemoBlock.CHECKED) {
        text.setSpan(MemoCheckedColorSpan(theme.mutedColor), paragraph.start, paragraph.end, SPAN_FLAGS)
      }
    }
  }

  /** 모든 문단의 스팬이 문단 경계와 맞도록 정리하고 번호를 매긴다. */
  fun normalize(text: Spannable, theme: MemoTheme) {
    val paragraphs = paragraphs(text)
    val blocks = paragraphs.map { blockOf(text, it) }
    var number = 0
    for ((index, paragraph) in paragraphs.withIndex()) {
      val block = blocks[index]
      number = if (block == MemoBlock.NUMBER) number + 1 else 0
      setBlock(text, paragraph, block, theme, number)
    }
  }

  fun serialize(text: Spanned): String {
    val blocks = JSONArray()
    for (paragraph in paragraphs(text)) {
      val block = blockOf(text, paragraph)
      val runs = JSONArray()
      val piece = StringBuilder()
      var current: InlineFlags? = null
      fun flush() {
        val flags = current ?: return
        if (piece.isEmpty()) return
        runs.put(JSONObject().apply {
          put("text", piece.toString())
          if (flags.bold) put("bold", true)
          if (flags.underline) put("underline", true)
          if (flags.strikethrough) put("strikethrough", true)
        })
        piece.clear()
      }
      for (i in paragraph.start until contentEnd(text, paragraph)) {
        val char = text[i]
        if (char == PLACEHOLDER) continue
        val flags = flagsAt(text, i)
        if (flags != current) flush()
        current = flags
        piece.append(char)
      }
      flush()
      blocks.put(JSONObject().apply {
        put("type", block.kind.raw)
        if (block.isCheckbox) put("checked", block == MemoBlock.CHECKED)
        put("runs", runs)
      })
    }
    return JSONObject().put("version", 1).put("blocks", blocks).toString()
  }

  fun deserialize(json: String?, theme: MemoTheme): SpannableStringBuilder {
    val result = SpannableStringBuilder()
    if (json.isNullOrEmpty()) return result
    val blocks = try {
      JSONObject(json).getJSONArray("blocks")
    } catch (error: Exception) {
      return result
    }

    for (index in 0 until blocks.length()) {
      val item = blocks.optJSONObject(index) ?: continue
      var block = MemoBlock.fromRaw(item.optString("type"))
      if (block == MemoBlock.CHECKBOX && item.optBoolean("checked", false)) block = MemoBlock.CHECKED
      val paragraphStart = result.length

      val runs = item.optJSONArray("runs") ?: JSONArray()
      for (runIndex in 0 until runs.length()) {
        val run = runs.optJSONObject(runIndex) ?: continue
        // 저장 데이터에 줄바꿈이 섞여 있어도 문단 구조가 깨지지 않도록 공백으로 바꾼다.
        val piece = run.optString("text").replace('\n', ' ').replace(PLACEHOLDER.toString(), "")
        if (piece.isEmpty()) continue
        val start = result.length
        result.append(piece)
        applyInline(
          result,
          start,
          result.length,
          InlineFlags(run.optBoolean("bold"), run.optBoolean("underline"), run.optBoolean("strikethrough"))
        )
      }

      val isLast = index == blocks.length() - 1
      if (!isLast) {
        result.append('\n')
      } else if (result.length == paragraphStart && block.isList) {
        result.append(PLACEHOLDER)
      }
      if (block.isList && result.length > paragraphStart) {
        setBlock(result, Paragraph(paragraphStart, result.length), block, theme)
      }
    }
    normalize(result, theme)
    return result
  }
}
