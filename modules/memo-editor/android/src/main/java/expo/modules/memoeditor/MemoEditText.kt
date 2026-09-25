package expo.modules.memoeditor

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.Context
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.widget.EditText

/** 편집기 뷰가 EditText의 입력 이벤트를 가로채기 위한 통로 */
interface MemoEditTextListener {
  fun onSelectionChanged(start: Int, end: Int)
  fun onBackspace(): Boolean
  fun checkboxParagraphStart(x: Float, y: Float): Int?
  fun onCheckboxTap(paragraphStart: Int)
  fun onPastePlainText(text: String)
}

@SuppressLint("AppCompatCustomView", "ViewConstructor")
class MemoEditText(context: Context) : EditText(context) {
  // EditText 생성자 안에서도 선택 변경 콜백이 불리므로 나중에 연결한다.
  var listener: MemoEditTextListener? = null
  private var pressedCheckbox: Int? = null

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    val base = super.onCreateInputConnection(outAttrs) ?: return null
    return object : InputConnectionWrapper(base, true) {
      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        if (beforeLength == 1 && afterLength == 0 && listener?.onBackspace() == true) return true
        return super.deleteSurroundingText(beforeLength, afterLength)
      }

      override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
        if (beforeLength == 1 && afterLength == 0 && listener?.onBackspace() == true) return true
        return super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
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
  override fun onTextContextMenuItem(id: Int): Boolean {
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
    // 키보드가 올라와 높이가 줄면 커서가 가려지지 않게 따라 스크롤한다.
    if (height < oldHeight && hasFocus()) {
      post { bringPointIntoView(selectionEnd.coerceAtLeast(0)) }
    }
  }
}
