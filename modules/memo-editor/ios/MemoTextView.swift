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

final class MemoTextView: UITextView {
  weak var editor: MemoEditorView?
  let markerView = MemoMarkerView()
  let placeholderLabel = UILabel()
  let checkboxTap = UITapGestureRecognizer()
  private var lastHeight: CGFloat = 0

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

