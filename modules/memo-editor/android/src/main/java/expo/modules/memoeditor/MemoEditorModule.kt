package expo.modules.memoeditor

import android.graphics.Color
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS에서는 '#RRGGBB' 문자열로 넘어온다.
private fun parseColor(value: String?): Int? =
  try {
    value?.let { Color.parseColor(it) }
  } catch (error: IllegalArgumentException) {
    null
  }

class MemoEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MemoEditor")

    View(MemoEditorView::class) {
      Events("onChangeContent", "onChangeFormat", "onFocusChange", "onLeaveParagraph")

      Prop("initialContent") { view: MemoEditorView, value: String? ->
        view.setInitialContent(value)
      }
      Prop("placeholder") { view: MemoEditorView, value: String? ->
        view.placeholder = value ?: ""
      }
      Prop("autoFocus") { view: MemoEditorView, value: Boolean? ->
        view.autoFocus = value ?: false
      }
      Prop("fontSize") { view: MemoEditorView, value: Double? ->
        view.theme.fontSize = (value ?: 18.0).toFloat()
        view.markThemeDirty()
      }
      Prop("textColor") { view: MemoEditorView, value: String? ->
        parseColor(value)?.let { view.theme.textColor = it }
        view.markThemeDirty()
      }
      Prop("mutedColor") { view: MemoEditorView, value: String? ->
        parseColor(value)?.let { view.theme.mutedColor = it }
        view.markThemeDirty()
      }
      Prop("accentColor") { view: MemoEditorView, value: String? ->
        parseColor(value)?.let { view.theme.accentColor = it }
        view.markThemeDirty()
      }
      Prop("placeholderColor") { view: MemoEditorView, value: String? ->
        parseColor(value)?.let { view.theme.placeholderColor = it }
        view.markThemeDirty()
      }
      Prop("insetHorizontal") { view: MemoEditorView, value: Double? ->
        view.insetHorizontal = (value ?: 20.0).toFloat()
      }
      Prop("insetTop") { view: MemoEditorView, value: Double? ->
        view.insetTop = (value ?: 14.0).toFloat()
      }

      OnViewDidUpdateProps { view: MemoEditorView ->
        view.didUpdateProps()
      }

      AsyncFunction("focus") { view: MemoEditorView ->
        view.focusEditor()
      }
      AsyncFunction("blur") { view: MemoEditorView ->
        view.blurEditor()
      }
      AsyncFunction("toggleBold") { view: MemoEditorView ->
        view.toggleInline(InlineStyle.BOLD)
      }
      AsyncFunction("toggleUnderline") { view: MemoEditorView ->
        view.toggleInline(InlineStyle.UNDERLINE)
      }
      AsyncFunction("toggleStrikethrough") { view: MemoEditorView ->
        view.toggleInline(InlineStyle.STRIKETHROUGH)
      }
      AsyncFunction("toggleBlock") { view: MemoEditorView, kind: String ->
        view.toggleBlock(kind)
      }
      AsyncFunction("setParagraphBlock") { view: MemoEditorView, index: Int, text: String, from: String, to: String ->
        view.setParagraphBlock(index, text, from, to)
      }
    }
  }
}
