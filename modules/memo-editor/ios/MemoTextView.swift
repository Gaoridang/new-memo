import UIKit

/// 체크박스, 글머리 기호, 번호를 본문 뒤에 그리는 뷰. 텍스트 뷰의 서브뷰라 함께 스크롤된다.
final class MemoMarkerView: UIView {
  weak var editor: MemoEditorView?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    backgroundColor = .clear
    isOpaque = false
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func draw(_ rect: CGRect) {
    editor?.drawMarkers(in: rect)
  }
}

/// 흔들기, 세 손가락 쓸기, ⌘Z도 편집기의 되돌리기 기록을 따르게 한다.
/// UIKit이 타이핑마다 남기는 기록은 받지 않는다. 서식과 할 일 바꾸기를 모르는 두 번째 기록이 되기 때문이다.
final class MemoUndoManager: UndoManager {
  weak var editor: MemoEditorView?

  override init() {
    super.init()
    disableUndoRegistration()
  }

  override var canUndo: Bool { editor?.canUndo ?? false }
  override var canRedo: Bool { editor?.canRedo ?? false }

  override func undo() {
    editor?.undo()
  }

  override func redo() {
    editor?.redo()
  }
}

final class MemoTextView: UITextView {
  weak var editor: MemoEditorView?
  let markerView = MemoMarkerView()
  let placeholderLabel = UILabel()
  let checkboxTap = UITapGestureRecognizer()
  let memoUndoManager = MemoUndoManager()
  private var lastHeight: CGFloat = 0

  /// 키보드 위에 붙일 RN InputAccessoryView의 nativeID. 제목 칸과 같은 컨트롤 바를 함께 쓴다.
  var accessoryID: String? {
    didSet {
      if accessoryID != oldValue { accessory = nil }
    }
  }
  private weak var accessory: UIView?

  override var undoManager: UndoManager? { memoUndoManager }

  // 키보드가 뜰 때 UIKit이 읽어 키보드와 함께 움직인다. RN의 InputAccessoryView가 가진 뷰를 찾아 쓴다.
  override var inputAccessoryView: UIView? {
    get {
      if accessory == nil, let accessoryID, let window {
        accessory = Self.accessoryView(nativeID: accessoryID, in: window)
      }
      return accessory
    }
    set { accessory = newValue }
  }

  private static func accessoryView(nativeID: String, in view: UIView) -> UIView? {
    if view.responds(to: NSSelectorFromString("nativeId")),
       view.value(forKey: "nativeId") as? String == nativeID {
      return view.inputAccessoryView
    }
    for subview in view.subviews {
      if let found = accessoryView(nativeID: nativeID, in: subview) { return found }
    }
    return nil
  }

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    insertSubview(markerView, at: 0)
    placeholderLabel.isUserInteractionEnabled = false
    addSubview(placeholderLabel)
    addGestureRecognizer(checkboxTap)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()

    let markerFrame = CGRect(x: 0, y: 0, width: bounds.width, height: max(contentSize.height, bounds.height))
    if markerView.frame != markerFrame {
      markerView.frame = markerFrame
      markerView.setNeedsDisplay()
    }

    let inset = textContainerInset
    placeholderLabel.frame = CGRect(
      x: inset.left,
      y: inset.top,
      width: max(0, bounds.width - inset.left - inset.right),
      height: editor?.theme.lineHeight ?? 22)

    // 키보드가 올라와 높이가 줄면 커서가 가려지지 않게 따라 스크롤한다.
    if bounds.height < lastHeight - 0.5 && isFirstResponder {
      scrollCaretIntoView()
    }
    lastHeight = bounds.height
  }

  func scrollCaretIntoView() {
    guard let end = selectedTextRange?.end else { return }
    scrollRectToVisible(caretRect(for: end).insetBy(dx: 0, dy: -12), animated: false)
  }

  // 마지막 빈 줄에는 글자가 없어 UIKit이 문단 들여쓰기를 모르므로 목록이면 직접 옮긴다.
  override func caretRect(for position: UITextPosition) -> CGRect {
    var rect = super.caretRect(for: position)
    guard let editor else { return rect }
    let offset = self.offset(from: beginningOfDocument, to: position)
    let string = textStorage.string as NSString
    if offset >= string.length && string.endsWithEmptyParagraph {
      rect.origin.x = textContainerInset.left + (editor.trailingBlock.isList ? editor.theme.listIndent : 0)
    }
    return rect
  }

  // 체크박스를 누르면 커서 이동이나 키보드 없이 체크만 바뀌도록 텍스트 뷰의 탭 제스처를 막는다.
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    let onCheckbox = editor?.checkboxParagraph(at: gestureRecognizer.location(in: self)) != nil
    if gestureRecognizer === checkboxTap {
      return onCheckbox
    }
    if onCheckbox && !(gestureRecognizer is UIPanGestureRecognizer) && !(gestureRecognizer is UIPinchGestureRecognizer) {
      return false
    }
    return super.gestureRecognizerShouldBegin(gestureRecognizer)
  }

  // 빈 본문에서 지우면 지울 글자가 없어 편집 콜백이 오지 않으므로 여기서 받는다.
  override func deleteBackward() {
    if editor?.deleteBackwardInEmptyDocument() == true { return }
    super.deleteBackward()
  }

  // 다른 앱의 서식은 버리고 글자만 붙여 넣는다.
  override func paste(_ sender: Any?) {
    guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
    let normalized = text
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .replacingOccurrences(of: "\u{2028}", with: "\n")
      .replacingOccurrences(of: "\u{2029}", with: "\n")
    insertText(normalized)
  }
}

