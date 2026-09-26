import ExpoModulesCore

/// index번째 문단의 내용이 text이고 종류가 from이면 to로 바꾼다.
struct ParagraphBlockChange: Record {
  @Field var index: Int = 0
  @Field var text: String = ""
  @Field var from: String = ""
  @Field var to: String = ""
}

/// index번째 문단의 내용이 text이고 start부터 length만큼(UTF-16)이 word이면 그 낱말 뒤에 id 두들을 붙인다.
struct DoodleChange: Record {
  @Field var index: Int = 0
  @Field var text: String = ""
  @Field var start: Int = 0
  @Field var length: Int = 0
  @Field var word: String = ""
  @Field var id: String = ""
}

/// 두들 그림 한 겹 (24x24 격자, M·L·C·Q·Z 경로, '#RRGGBB' 색)
struct DoodleOpRecord: Record {
  @Field var d: String = ""
  @Field var fill: String?
  @Field var stroke: String?
  @Field var width: Double?
  @Field var opacity: Double?
  @Field var dx: Double?
  @Field var dy: Double?
}

/// 두들 그림 하나와, 두들을 붙인 낱말을 감싸는 칩의 색
struct DoodleArtRecord: Record {
  @Field var id: String = ""
  @Field var ops: [DoodleOpRecord] = []
  @Field var chipFill: String?
}

public class MemoEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MemoEditor")

    View(MemoEditorView.self) {
      Events(
        "onChangeContent", "onChangeFormat", "onChangeHistory", "onFocusChange", "onLeaveParagraph",
        "onBackspaceWhenEmpty")

      Prop("initialContent") { (view: MemoEditorView, value: String?) in
        view.setInitialContent(value)
      }
      Prop("placeholder") { (view: MemoEditorView, value: String?) in
        view.placeholder = value ?? ""
      }
      Prop("autoFocus") { (view: MemoEditorView, value: Bool?) in
        view.autoFocus = value ?? false
      }
      Prop("fontSize") { (view: MemoEditorView, value: Double?) in
        view.theme.fontSize = CGFloat(value ?? 18)
      }
      Prop("textColor") { (view: MemoEditorView, value: UIColor?) in
        if let value { view.theme.textColor = value }
      }
      Prop("mutedColor") { (view: MemoEditorView, value: UIColor?) in
        if let value { view.theme.mutedColor = value }
      }
      Prop("accentColor") { (view: MemoEditorView, value: UIColor?) in
        if let value { view.theme.accentColor = value }
      }
      Prop("placeholderColor") { (view: MemoEditorView, value: UIColor?) in
        if let value { view.theme.placeholderColor = value }
      }
      Prop("insetHorizontal") { (view: MemoEditorView, value: Double?) in
        view.insetHorizontal = CGFloat(value ?? 20)
      }
      Prop("insetTop") { (view: MemoEditorView, value: Double?) in
        view.insetTop = CGFloat(value ?? 14)
      }
      Prop("accessoryID") { (view: MemoEditorView, value: String?) in
        view.textView.accessoryID = value
      }
      Prop("doodleArt") { (view: MemoEditorView, value: [DoodleArtRecord]?) in
        view.doodleArt = MemoDoodles.parseArt(value ?? [])
      }

      OnViewDidUpdateProps { (view: MemoEditorView) in
        view.didUpdateProps()
      }

      AsyncFunction("focus") { (view: MemoEditorView) in
        view.focus()
      }.runOnQueue(.main)

      AsyncFunction("blur") { (view: MemoEditorView) in
        view.blur()
      }.runOnQueue(.main)

      AsyncFunction("toggleBold") { (view: MemoEditorView) in
        view.toggleInline(\.bold)
      }.runOnQueue(.main)

      AsyncFunction("toggleUnderline") { (view: MemoEditorView) in
        view.toggleInline(\.underline)
      }.runOnQueue(.main)

      AsyncFunction("toggleStrikethrough") { (view: MemoEditorView) in
        view.toggleInline(\.strikethrough)
      }.runOnQueue(.main)

      AsyncFunction("toggleBlock") { (view: MemoEditorView, kind: String) in
        view.toggleBlock(named: kind)
      }.runOnQueue(.main)

      AsyncFunction("setParagraphBlocks") { (view: MemoEditorView, changes: [ParagraphBlockChange]) -> [Bool] in
        view.setParagraphBlocks(changes)
      }.runOnQueue(.main)

      AsyncFunction("setDoodles") { (view: MemoEditorView, changes: [DoodleChange], explicit: Bool) -> [Bool] in
        view.setDoodles(changes, explicit: explicit)
      }.runOnQueue(.main)

      AsyncFunction("removeDoodles") { (view: MemoEditorView) -> Int in
        view.removeDoodles()
      }.runOnQueue(.main)

      AsyncFunction("undo") { (view: MemoEditorView) in
        view.undo()
      }.runOnQueue(.main)

      AsyncFunction("redo") { (view: MemoEditorView) in
        view.redo()
      }.runOnQueue(.main)
    }
  }
}
