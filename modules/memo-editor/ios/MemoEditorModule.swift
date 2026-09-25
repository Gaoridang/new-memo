import ExpoModulesCore

public class MemoEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MemoEditor")

    View(MemoEditorView.self) {
      Events("onChangeContent", "onChangeFormat", "onFocusChange")

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
    }
  }
}
