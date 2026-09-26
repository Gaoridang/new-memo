package expo.modules.memoeditor

import android.graphics.Color
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// JS에서는 '#RRGGBB' 문자열로 넘어온다.
private fun parseColor(value: String?): Int? =
  try {
    value?.let { Color.parseColor(it) }
  } catch (error: IllegalArgumentException) {
    null
  }

/** index번째 문단의 내용이 text이고 종류가 from이면 to로 바꾼다. */
class ParagraphBlockChange : Record {
  @Field
  val index: Int = 0

  @Field
  val text: String = ""

  @Field
  val from: String = ""

  @Field
  val to: String = ""
}

/** index번째 문단의 내용이 text이고 start부터 length만큼(UTF-16)이 word이면 그 낱말 뒤에 id 두들을 붙인다. */
class DoodleChange : Record {
  @Field
  val index: Int = 0

  @Field
  val text: String = ""

  @Field
  val start: Int = 0

  @Field
  val length: Int = 0

  @Field
  val word: String = ""

  @Field
  val id: String = ""
}

/** 두들 그림 한 겹 (24x24 격자, M·L·C·Q·Z 경로, '#RRGGBB' 색) */
class DoodleOpRecord : Record {
  @Field
  val d: String = ""

  @Field
  val fill: String? = null

  @Field
  val stroke: String? = null

  @Field
  val width: Double? = null

  @Field
  val opacity: Double? = null

  @Field
  val dx: Double? = null

  @Field
  val dy: Double? = null
}

/** 두들 그림 하나와, 두들을 붙인 낱말을 감싸는 칩의 색 */
class DoodleArtRecord : Record {
  @Field
  val id: String = ""

  @Field
  val ops: List<DoodleOpRecord> = emptyList()

  @Field
  val chipFill: String? = null
}

class MemoEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MemoEditor")

    View(MemoEditorView::class) {
      Events("onChangeContent", "onChangeFormat", "onChangeHistory", "onFocusChange", "onLeaveParagraph")

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
      // iOS에서 키보드 위에 붙일 컨트롤 바. Android에는 그런 자리가 없어 JS가 키보드를 따라 띄운다.
      Prop("accessoryID") { _: MemoEditorView, _: String? -> }
      Prop("doodleArt") { view: MemoEditorView, value: List<DoodleArtRecord>? ->
        view.setDoodleArt(value ?: emptyList())
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
      AsyncFunction("setParagraphBlocks") { view: MemoEditorView, changes: List<ParagraphBlockChange> ->
        view.setParagraphBlocks(changes)
      }
      AsyncFunction("setDoodles") { view: MemoEditorView, changes: List<DoodleChange>, explicit: Boolean ->
        view.setDoodles(changes, explicit)
      }
      AsyncFunction("removeDoodles") { view: MemoEditorView ->
        view.removeDoodles()
      }
      AsyncFunction("undo") { view: MemoEditorView ->
        view.undo()
      }
      AsyncFunction("redo") { view: MemoEditorView ->
        view.redo()
      }
    }
  }
}
