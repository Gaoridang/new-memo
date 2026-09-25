package expo.modules.memoeditor

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

class MemoEditorView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), MemoEditTextListener {

  private val onChangeContent by EventDispatcher()
  private val onChangeFormat by EventDispatcher()
  private val onFocusChange by EventDispatcher()
  private val onLeaveParagraph by EventDispatcher()

  override val shouldUseAndroidLayout = true

  val theme = MemoTheme(resources.displayMetrics.density)
  private val editText = MemoEditText(context)

  var placeholder = ""
    set(value) {
      field = value
      editText.hint = value
    }
  var autoFocus = false
  var insetHorizontal = 20f
    set(value) {
      field = value
      updatePadding()
    }
  var insetTop = 14f
    set(value) {
      field = value
      updatePadding()
    }

  private var themeDirty = true
  private var pendingContent: String? = null
  private var didLoadContent = false
  private var didAutoFocus = false

  // 편집 중 상태
  private var applying = false
  private var pendingInline: InlineFlags? = null
  private var pendingPosition = -1
  private var intendedInline: InlineFlags? = null
  private var changeStart = 0
  private var changeBefore = 0
  private var changeCount = 0
  private var lastContent: String? = null
  private var lastFormat: Pair<InlineFlags, MemoBlock>? = null

  /** 커서가 있는 문단. 고친 문단에서 커서가 떠나면 JS에 알린다. (할 일 자동 감지) */
  private data class ActiveParagraph(val index: Int, val text: String, val edited: Boolean)
  private var activeParagraph: ActiveParagraph? = null

  private val inputMethodManager: InputMethodManager
    get() = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

  private val watcher = object : TextWatcher {
    override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {
      if (applying) return
      val text = editText.text ?: return
      // 한글 조합처럼 글자를 바꿔 치우는 입력은 바뀌는 글자의 서식을, 새로 넣는 글자는 커서 자리의 서식을 따른다.
      intendedInline = when {
        count > 0 -> MemoDocument.flagsAt(text, start)
        pendingInline != null && pendingPosition == start -> pendingInline
        else -> insertionFlags(start)
      }
    }

    override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
      if (applying) return
      changeStart = start
      changeBefore = before
      changeCount = count
    }

    override fun afterTextChanged(s: Editable) {
      if (applying) return
      applying = true
      try {
        handleTextChange(s)
      } finally {
        applying = false
      }
      emitContentIfChanged()
      emitFormat()
      if (editText.isFocused) trackActiveParagraph(edited = true)
    }
  }

  init {
    editText.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    editText.background = null
    editText.gravity = Gravity.TOP or Gravity.START
    editText.inputType = InputType.TYPE_CLASS_TEXT or
      InputType.TYPE_TEXT_FLAG_MULTI_LINE or
      InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
    editText.imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI
    editText.isVerticalScrollBarEnabled = true
    editText.setHorizontallyScrolling(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      editText.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
    }
    editText.listener = this
    editText.addTextChangedListener(watcher)
    editText.setOnFocusChangeListener { _, focused ->
      if (focused) trackActiveParagraph(edited = false) else leaveActiveParagraph()
      onFocusChange(mapOf("focused" to focused))
    }
    addView(editText)
    updatePadding()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    editText.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    )
    editText.layout(0, 0, width, height)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    focusIfNeeded()
  }

  // region Props

  fun setInitialContent(json: String?) {
    if (!didLoadContent) pendingContent = json ?: ""
  }

  fun markThemeDirty() {
    themeDirty = true
  }

  fun didUpdateProps() {
    if (themeDirty) {
      themeDirty = false
      applyTheme()
    }
    if (!didLoadContent) {
      didLoadContent = true
      load(pendingContent)
      pendingContent = null
    }
    focusIfNeeded()
  }

  private fun updatePadding() {
    val horizontal = theme.px(insetHorizontal).roundToInt()
    editText.setPadding(horizontal, theme.px(insetTop).roundToInt(), horizontal, theme.px(24f).roundToInt())
  }

  private fun applyTheme() {
    // 명세대로 크기를 고정하기 위해 sp가 아닌 dp로 지정한다.
    editText.setTextSize(TypedValue.COMPLEX_UNIT_DIP, theme.fontSize)
    editText.setTextColor(theme.textColor)
    editText.setHintTextColor(theme.placeholderColor)
    editText.highlightColor = (theme.accentColor and 0x00FFFFFF) or 0x40000000
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // 한글(대체 글꼴)이 섞여도 줄 간격이 흔들리지 않게 고정한다.
      editText.isFallbackLineSpacing = false
      editText.lineHeight = theme.lineHeightPx
    } else {
      val metrics = editText.paint.fontMetricsInt
      editText.setLineSpacing((theme.lineHeightPx - (metrics.descent - metrics.ascent)).toFloat(), 1f)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      editText.textCursorDrawable = GradientDrawable().apply {
        setColor(theme.accentColor)
        setSize(theme.px(2f).roundToInt(), theme.textSizePx.roundToInt())
      }
      // 커서 손잡이도 커서와 같은 강조색으로 맞춘다.
      editText.textSelectHandle?.mutate()?.let {
        it.setTint(theme.accentColor)
        editText.setTextSelectHandle(it)
      }
      editText.textSelectHandleLeft?.mutate()?.let {
        it.setTint(theme.accentColor)
        editText.setTextSelectHandleLeft(it)
      }
      editText.textSelectHandleRight?.mutate()?.let {
        it.setTint(theme.accentColor)
        editText.setTextSelectHandleRight(it)
      }
    }
    editText.invalidate()
  }

  private fun load(json: String?) {
    applying = true
    try {
      editText.setText(MemoDocument.deserialize(json, theme), TextView.BufferType.EDITABLE)
      editText.setSelection(editText.text?.length ?: 0)
    } finally {
      applying = false
    }
    lastContent = editText.text?.let { MemoDocument.serialize(it) }
    emitFormat()
  }

  // endregion

  // region Focus

  private fun focusIfNeeded() {
    if (!autoFocus || didAutoFocus || !didLoadContent || !isAttachedToWindow) return
    didAutoFocus = true
    editText.setSelection(editText.text?.length ?: 0)
    focusEditor()
  }

  fun focusEditor() {
    editText.requestFocus()
    showKeyboard()
  }

  fun blurEditor() {
    inputMethodManager.hideSoftInputFromWindow(editText.windowToken, 0)
    editText.clearFocus()
  }

  // 앱을 막 열었을 때는 창 포커스나 입력기 연결이 늦게 준비되어 첫 요청이 무시된다.
  // 키보드가 실제로 뜰 때까지 잠깐(최대 약 3초) 포커스와 표시를 다시 시도한다.
  private fun showKeyboard(attempt: Int = 0) {
    editText.postDelayed({
      if (isKeyboardVisible()) return@postDelayed
      if (!editText.isFocused) editText.requestFocus()
      val requested = editText.isFocused && editText.hasWindowFocus() &&
        inputMethodManager.showSoftInput(editText, 0)
      // API 30 미만은 키보드 표시 여부를 알 수 없으니 요청이 받아들여지면 멈춘다.
      if (requested && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@postDelayed
      if (attempt < 20) showKeyboard(attempt + 1)
    }, if (attempt == 0) 50L else 150L)
  }

  private fun isKeyboardVisible(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      return editText.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true
    }
    return false
  }

  // endregion

  // region Commands

  fun toggleInline(style: InlineStyle) {
    endComposition()
    val text = editText.text ?: return
    val start = minOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    val end = maxOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)

    if (start != end) {
      val turnOn = !(MemoDocument.commonFlags(text, start, end)?.has(style) ?: false)
      MemoDocument.setInline(text, start, end, style, turnOn)
      emitContentIfChanged()
    } else {
      // 선택 영역이 없으면 다음에 입력할 글자의 서식만 바꾼다.
      val base = pendingInline?.takeIf { pendingPosition == start } ?: insertionFlags(start)
      pendingInline = base.with(style, !base.has(style))
      pendingPosition = start
    }
    emitFormat()
  }

  fun toggleBlock(raw: String) {
    val kind = MemoBlock.fromRaw(raw)
    if (!kind.isList || kind == MemoBlock.CHECKED) return
    endComposition()
    val text = editText.text ?: return
    val start = minOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    val end = maxOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    val paragraphs = if (start == end) {
      listOf(MemoDocument.paragraphAt(text, start))
    } else {
      MemoDocument.paragraphs(text).filter { !it.isEmpty && it.start < end && start < it.end }
    }
    val allMatch = paragraphs.all { MemoDocument.blockOf(text, it).kind == kind }

    applying = true
    try {
      // 자리 표시 문자를 넣고 빼도 앞 문단 위치가 흔들리지 않도록 뒤에서부터 바꾼다.
      for (paragraph in paragraphs.sortedByDescending { it.start }) {
        val current = MemoDocument.blockOf(text, paragraph)
        val target = when {
          allMatch -> MemoBlock.PARAGRAPH
          kind == MemoBlock.CHECKBOX && current.isCheckbox -> current
          else -> kind
        }
        applyBlock(text, paragraph, target)
      }
      MemoDocument.normalize(text, theme)
    } finally {
      applying = false
    }
    editText.invalidate()
    emitContentIfChanged()
    emitFormat()
  }

  /** index번째 문단의 내용이 expected이고 종류가 from일 때만 to로 바꾼다. 커서와 스크롤은 그대로 둔다. */
  fun setParagraphBlock(index: Int, expected: String, from: String, to: String): Boolean {
    val text = editText.text ?: return false
    val paragraphs = MemoDocument.paragraphs(text)
    if (index < 0 || index >= paragraphs.size) return false
    val paragraph = paragraphs[index]
    if (paragraph.isEmpty || contentText(text, paragraph) != expected) return false
    if (MemoDocument.blockOf(text, paragraph).kind != MemoBlock.fromRaw(from).kind) return false

    endComposition()
    applying = true
    try {
      MemoDocument.setBlock(text, paragraph, MemoBlock.fromRaw(to), theme)
      MemoDocument.normalize(text, theme)
    } finally {
      applying = false
    }
    editText.invalidate()
    emitContentIfChanged()
    emitFormat()
    return true
  }

  private fun applyBlock(text: Editable, paragraph: Paragraph, block: MemoBlock) {
    val placeholderOnly = !paragraph.isEmpty && text[paragraph.start] == PLACEHOLDER &&
      !MemoDocument.hasVisibleContent(text, paragraph) && paragraph.end == text.length
    when {
      paragraph.isEmpty && block.isList -> {
        // 글자가 없는 마지막 줄에는 자리 표시 문자를 넣어 목록 줄로 만든다.
        text.insert(paragraph.start, PLACEHOLDER.toString())
        MemoDocument.setBlock(text, Paragraph(paragraph.start, paragraph.start + 1), block, theme)
        editText.setSelection(paragraph.start + 1)
      }
      placeholderOnly && !block.isList -> text.delete(paragraph.start, paragraph.start + 1)
      else -> MemoDocument.setBlock(text, paragraph, block, theme)
    }
  }

  // endregion

  // region Text changes

  private fun handleTextChange(text: Editable) {
    val start = changeStart
    val count = changeCount
    if (count > 0) {
      MemoDocument.applyInline(text, start, start + count, intendedInline ?: InlineFlags())
      if (pendingPosition == start) {
        pendingInline = null
        pendingPosition = -1
      }
    }
    MemoDocument.normalize(text, theme)
    if (changeBefore == 0 && count == 1 && text[start] == '\n') {
      handleNewline(text, start)
    }
    removeStrayPlaceholders(text)
    editText.invalidate()
  }

  private fun handleNewline(text: Editable, position: Int) {
    val paragraph = MemoDocument.paragraphAt(text, position)
    val block = MemoDocument.blockOf(text, paragraph)
    if (!block.isList) return

    if (!MemoDocument.hasVisibleContent(text, paragraph)) {
      // 빈 목록 줄에서 엔터를 누르면 줄을 늘리지 않고 목록만 끝낸다.
      text.delete(position, position + 1)
      if (paragraph.start < text.length && text[paragraph.start] == PLACEHOLDER) {
        text.delete(paragraph.start, paragraph.start + 1)
      }
      MemoDocument.setBlock(text, MemoDocument.paragraphAt(text, paragraph.start), MemoBlock.PARAGRAPH, theme)
      MemoDocument.normalize(text, theme)
      return
    }

    val next = MemoDocument.paragraphAt(text, position + 1)
    if (next.isEmpty) {
      text.insert(position + 1, PLACEHOLDER.toString())
      MemoDocument.setBlock(text, Paragraph(position + 1, position + 2), block.continuation, theme)
      editText.setSelection(position + 2)
    } else {
      MemoDocument.setBlock(text, next, block.continuation, theme)
    }
    MemoDocument.normalize(text, theme)
  }

  /** 글자가 생긴 문단의 자리 표시 문자는 지운다. 한글 조합 중에는 건드리지 않는다. */
  private fun removeStrayPlaceholders(text: Editable) {
    if (BaseInputConnection.getComposingSpanStart(text) != -1) return
    var index = text.length - 1
    while (index >= 0) {
      if (text[index] == PLACEHOLDER) {
        val paragraph = MemoDocument.paragraphAt(text, index)
        val keep = index == paragraph.start && paragraph.end == text.length &&
          !MemoDocument.hasVisibleContent(text, paragraph) &&
          MemoDocument.blockOf(text, paragraph).isList
        if (!keep) text.delete(index, index + 1)
      }
      index--
    }
  }

  /** 서식을 바꾸기 전에 조합 중인 글자를 확정해, 다음 자모가 앞 글자에 붙지 않게 한다. */
  private fun endComposition() {
    val text = editText.text ?: return
    if (BaseInputConnection.getComposingSpanStart(text) == -1) return
    BaseInputConnection.removeComposingSpans(text)
    inputMethodManager.restartInput(editText)
  }

  private fun contentText(text: CharSequence, paragraph: Paragraph): String =
    text.subSequence(paragraph.start, MemoDocument.contentEnd(text, paragraph)).toString()
      .replace(PLACEHOLDER.toString(), "")

  private fun paragraphIndex(text: CharSequence, offset: Int): Int {
    var index = 0
    for (i in 0 until offset.coerceIn(0, text.length)) {
      if (text[i] == '\n') index++
    }
    return index
  }

  private fun trackActiveParagraph(edited: Boolean) {
    val text = editText.text ?: return
    val offset = editText.selectionStart.coerceAtLeast(0)
    val index = paragraphIndex(text, offset)
    if (activeParagraph?.let { it.index != index } == true) leaveActiveParagraph()
    val wasEdited = activeParagraph?.edited ?: false
    activeParagraph = ActiveParagraph(index, contentText(text, MemoDocument.paragraphAt(text, offset)), wasEdited || edited)
  }

  /** 고친 일반 문단에서 커서가 떠났으면 그 문단을 알린다. 줄 나누기·합치기로 내용이 바뀌었으면 알리지 않는다. */
  private fun leaveActiveParagraph() {
    val active = activeParagraph ?: return
    activeParagraph = null
    if (!active.edited) return
    val text = editText.text ?: return
    val paragraphs = MemoDocument.paragraphs(text)
    if (active.index >= paragraphs.size) return
    val paragraph = paragraphs[active.index]
    val content = contentText(text, paragraph)
    if (content != active.text || content.isBlank()) return
    if (MemoDocument.blockOf(text, paragraph) != MemoBlock.PARAGRAPH) return
    onLeaveParagraph(mapOf("index" to active.index, "text" to content))
  }

  private fun insertionFlags(position: Int): InlineFlags {
    val text = editText.text ?: return InlineFlags()
    val paragraph = MemoDocument.paragraphAt(text, position)
    val visibleStart = MemoDocument.visibleStart(text, paragraph)
    return when {
      position > visibleStart -> MemoDocument.flagsAt(text, position - 1)
      MemoDocument.hasVisibleContent(text, paragraph) -> MemoDocument.flagsAt(text, visibleStart)
      else -> InlineFlags()
    }
  }

  // endregion

  // region MemoEditTextListener

  override fun onSelectionChanged(start: Int, end: Int) {
    if (start != pendingPosition || end != pendingPosition) {
      pendingInline = null
      pendingPosition = -1
    }
    if (applying) return
    val text = editText.text ?: return
    // 자리 표시 문자 앞에는 커서를 두지 않는다.
    if (start == end && start < text.length && text[start] == PLACEHOLDER) {
      editText.setSelection(start + 1)
      return
    }
    emitFormat()
    if (editText.isFocused) trackActiveParagraph(edited = false)
  }

  override fun onBackspace(): Boolean {
    val text = editText.text ?: return false
    val start = editText.selectionStart
    if (start < 0 || start != editText.selectionEnd) return false
    if (BaseInputConnection.getComposingSpanStart(text) != -1) return false
    val paragraph = MemoDocument.paragraphAt(text, start)
    val visibleStart = MemoDocument.visibleStart(text, paragraph)
    if (start != visibleStart || !MemoDocument.blockOf(text, paragraph).isList) return false

    // 목록 줄 맨 앞에서 지우면 윗줄과 합치지 않고 목록 표시만 없앤다.
    applying = true
    try {
      if (visibleStart > paragraph.start) {
        text.delete(paragraph.start, visibleStart)
      }
      MemoDocument.setBlock(text, MemoDocument.paragraphAt(text, paragraph.start), MemoBlock.PARAGRAPH, theme)
      MemoDocument.normalize(text, theme)
    } finally {
      applying = false
    }
    editText.invalidate()
    emitContentIfChanged()
    emitFormat()
    return true
  }

  override fun checkboxParagraphStart(x: Float, y: Float): Int? {
    val layout = editText.layout ?: return null
    val text = editText.text ?: return null
    val left = editText.totalPaddingLeft.toFloat()
    if (x < left - theme.px(14f) || x > left + theme.listIndentPx) return null
    val line = layout.getLineForVertical((y - editText.totalPaddingTop + editText.scrollY).roundToInt())
    val lineStart = layout.getLineStart(line)
    val paragraph = MemoDocument.paragraphAt(text, lineStart)
    if (paragraph.isEmpty || paragraph.start != lineStart) return null
    return if (MemoDocument.blockOf(text, paragraph).isCheckbox) paragraph.start else null
  }

  override fun onCheckboxTap(paragraphStart: Int) {
    val text = editText.text ?: return
    val paragraph = MemoDocument.paragraphAt(text, paragraphStart)
    val block = MemoDocument.blockOf(text, paragraph)
    if (!block.isCheckbox) return
    MemoDocument.setBlock(
      text,
      paragraph,
      if (block == MemoBlock.CHECKED) MemoBlock.CHECKBOX else MemoBlock.CHECKED,
      theme
    )
    MemoDocument.normalize(text, theme)
    editText.invalidate()
    emitContentIfChanged()
    emitFormat()
  }

  override fun onPastePlainText(text: String) {
    val editable = editText.text ?: return
    val normalized = text
      .replace("\r\n", "\n")
      .replace('\r', '\n')
      .replace(' ', '\n')
      .replace(' ', '\n')
      .replace(PLACEHOLDER.toString(), "")
    val start = minOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    val end = maxOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    editable.replace(start, end, normalized)
  }

  // endregion

  // region Events

  private fun emitContentIfChanged() {
    val text = editText.text ?: return
    val content = MemoDocument.serialize(text)
    if (content == lastContent) return
    lastContent = content
    onChangeContent(mapOf("content" to content))
  }

  private fun emitFormat() {
    val text = editText.text ?: return
    val start = minOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    val end = maxOf(editText.selectionStart, editText.selectionEnd).coerceAtLeast(0)
    val inline = if (start != end) {
      MemoDocument.commonFlags(text, start, end) ?: InlineFlags()
    } else {
      pendingInline?.takeIf { pendingPosition == start } ?: insertionFlags(start)
    }
    val block = MemoDocument.blockOf(text, MemoDocument.paragraphAt(text, start)).kind
    val format = inline to block
    if (format == lastFormat) return
    lastFormat = format
    onChangeFormat(
      mapOf(
        "bold" to inline.bold,
        "underline" to inline.underline,
        "strikethrough" to inline.strikethrough,
        "block" to block.raw
      )
    )
  }

  // endregion
}
