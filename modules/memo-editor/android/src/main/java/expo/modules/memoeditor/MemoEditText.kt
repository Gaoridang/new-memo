package expo.modules.memoeditor

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.text.Layout
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.widget.EditText

/** 편집기 뷰가 EditText의 입력 이벤트를 가로채기 위한 통로 */
interface MemoEditTextListener {
  fun onSelectionChanged(start: Int, end: Int)
  /** 입력기가 한 번에 보내는 편집(batch edit)이 시작되거나(started) 끝났다. */
  fun onBatchEdit(started: Boolean)
  fun onBackspace(): Boolean
  /** 입력기가 조합 중인 낱말에서 끝 글자를 지우려 한다. text는 지운 뒤의 조합 글자다. 처리했으면 true */
  fun onComposingBackspace(text: CharSequence): Boolean
  fun checkboxParagraphStart(x: Float, y: Float): Int?
  fun onCheckboxTap(paragraphStart: Int)
  fun onPastePlainText(text: String)
  fun undo()
  fun redo()
}

@SuppressLint("AppCompatCustomView", "ViewConstructor")
class MemoEditText(context: Context) : EditText(context) {
  // EditText 생성자 안에서도 선택 변경 콜백이 불리므로 나중에 연결한다.
  var listener: MemoEditTextListener? = null
  /** 글자보다 먼저 그릴 것 (두들 칩). 좌표는 글 배치(layout) 기준이다. */
  var underlay: ((Canvas, Layout) -> Unit)? = null
  private var pressedCheckbox: Int? = null

  override fun onDraw(canvas: Canvas) {
    val layout = layout
    val underlay = underlay
    if (layout != null && underlay != null) {
      canvas.save()
      // TextView처럼 위 여백으로 스크롤되어 들어간 부분은 가린다. 옆으로는 칩 여백이 조금 나갈 수 있게 둔다.
      // 아래 여백에서는 글과 함께 보인다. (drawBottomPadding)
      val clipTop = if (scrollY == 0) 0 else extendedPaddingTop + scrollY
      canvas.clipRect(scrollX, clipTop, scrollX + width, height + scrollY)
      canvas.translate(totalPaddingLeft.toFloat(), totalPaddingTop.toFloat())
      underlay(canvas, layout)
      canvas.restore()
    }
    super.onDraw(canvas)
    drawBottomPadding(canvas)
  }

  /**
   * TextView는 끝까지 스크롤하지 않으면 아래 여백으로 들어간 글을 그리지 않는다.
   * 아래 여백은 떠 있는 컨트롤 바와 그 둘레 자리라, 컨트롤 바 뒤로도 글이 이어 보이도록 그 부분의 글을 더 그린다.
   * (커서와 선택 영역은 그리지 않는다. 커서 줄은 여백 위로 올라와 있다)
   */
  private fun drawBottomPadding(canvas: Canvas) {
    val layout = layout ?: return
    // 글이 없으면 TextView가 안내 문구를 그린다.
    if (text.isNullOrEmpty() || extendedPaddingBottom <= 0) return
    // TextView.onDraw와 같은 조건으로, 여백을 가리지 않았으면 그리지 않는다.
    val maxScrollY = layout.height - (height - extendedPaddingTop - extendedPaddingBottom)
    if (scrollY == maxScrollY) return
    canvas.save()
    canvas.clipRect(
      compoundPaddingLeft + scrollX,
      height + scrollY - extendedPaddingBottom,
      width - compoundPaddingRight + scrollX,
      height + scrollY
    )
    canvas.translate(compoundPaddingLeft.toFloat(), extendedPaddingTop.toFloat())
    layout.draw(canvas)
    canvas.restore()
  }

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    val base = super.onCreateInputConnection(outAttrs) ?: return null
    return object : InputConnectionWrapper(base, true) {
      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        if (afterLength == 0 && isCharacterBeforeCursor(beforeLength) && listener?.onBackspace() == true) return true
        return super.deleteSurroundingText(beforeLength, afterLength)
      }

      override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
        if (beforeLength == 1 && afterLength == 0 && listener?.onBackspace() == true) return true
        return super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
      }

      // 커서가 닿은 낱말을 다시 조합하는 입력기(영어 자동 고침)는 지우기를 한 글자 줄인 조합 글자로 보낸다.
      override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
        if (text != null && listener?.onComposingBackspace(text) == true) return true
        return super.setComposingText(text, newCursorPosition)
      }

      override fun sendKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_DEL && event.action == KeyEvent.ACTION_DOWN &&
          listener?.onBackspace() == true
        ) {
          return true
        }
        return super.sendKeyEvent(event)
      }
    }
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_DEL && listener?.onBackspace() == true) return true
    return super.onKeyDown(keyCode, event)
  }

  /** 커서 앞 한 글자의 길이인가. 입력기는 서로게이트 쌍(이모지 등)을 두 칸으로 지운다. */
  private fun isCharacterBeforeCursor(length: Int): Boolean {
    if (length == 1) return true
    val text = text ?: return false
    val end = selectionStart
    return length == 2 && end >= 2 && Character.isSurrogatePair(text[end - 2], text[end - 1])
  }

  // 포커스를 뺄 때 Android가 화면의 첫 입력칸인 이 편집기에 포커스를 다시 주지 않게 한다.
  override fun clearFocus() {
    isFocusableInTouchMode = false
    super.clearFocus()
    isFocusableInTouchMode = true
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    listener?.onSelectionChanged(selStart, selEnd)
  }

  // 입력기는 한 타에 여러 번 고칠 때 batch edit로 묶는다. (가장 바깥 batch에서만 불린다)
  override fun onBeginBatchEdit() {
    super.onBeginBatchEdit()
    listener?.onBatchEdit(started = true)
  }

  override fun onEndBatchEdit() {
    super.onEndBatchEdit()
    listener?.onBatchEdit(started = false)
  }

  // 체크박스를 누르면 커서 이동이나 키보드 없이 체크만 바뀌도록 터치를 가로챈다.
  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        pressedCheckbox = listener?.checkboxParagraphStart(event.x, event.y)
        if (pressedCheckbox != null) return true
      }
      MotionEvent.ACTION_MOVE -> if (pressedCheckbox != null) return true
      MotionEvent.ACTION_UP -> pressedCheckbox?.let { pressed ->
        pressedCheckbox = null
        if (listener?.checkboxParagraphStart(event.x, event.y) == pressed) {
          listener?.onCheckboxTap(pressed)
        }
        return true
      }
      MotionEvent.ACTION_CANCEL -> if (pressedCheckbox != null) {
        pressedCheckbox = null
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  // 다른 앱의 서식은 버리고 글자만 붙여 넣는다.
  // 되돌리기·다시 하기(메뉴, Ctrl+Z)는 EditText의 기록 대신 편집기의 기록을 쓴다.
  override fun onTextContextMenuItem(id: Int): Boolean {
    if (id == android.R.id.undo) {
      listener?.undo()
      return true
    }
    if (id == android.R.id.redo) {
      listener?.redo()
      return true
    }
    if (id == android.R.id.paste || id == android.R.id.pasteAsPlainText) {
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      val clip = clipboard?.primaryClip
      if (clip != null && clip.itemCount > 0) {
        val pasted = clip.getItemAt(0).coerceToText(context)?.toString().orEmpty()
        if (pasted.isNotEmpty()) listener?.onPastePlainText(pasted)
      }
      return true
    }
    return super.onTextContextMenuItem(id)
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    // 높이는 키보드를 따라 프레임마다 바뀐다. 줄면 커서가 가려지지 않게 따라 올리고,
    // 늘면 끝까지 스크롤해 둔 글이 끝에 빈자리를 남기지 않고 따라 내려온다.
    if (height < oldHeight && hasFocus()) {
      post { bringPointIntoView(selectionEnd.coerceAtLeast(0)) }
    } else if (height > oldHeight) {
      val layout = layout ?: return
      val maxScrollY = (layout.height - (height - extendedPaddingTop - extendedPaddingBottom)).coerceAtLeast(0)
      if (scrollY > maxScrollY) scrollTo(scrollX, maxScrollY)
    }
  }
}
