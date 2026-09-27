import UIKit

/// 문단 전환 애니메이션이 대신 그리는 동안 그 문단의 글자를 그리지 않는 레이아웃 매니저
final class MemoLayoutManager: NSLayoutManager {
  private var hiddenRanges: [NSRange] = []

  func hideCharacters(in range: NSRange) {
    hiddenRanges.append(range)
    redisplay(range)
  }

  func showCharacters(in range: NSRange) {
    guard let index = hiddenRanges.firstIndex(of: range) else { return }
    hiddenRanges.remove(at: index)
    redisplay(range)
  }

  /// 편집으로 글자 수가 줄었을 수 있으니 문서 안쪽만 다시 그린다.
  private func existing(_ range: NSRange) -> NSRange? {
    let clamped = NSIntersectionRange(range, NSRange(location: 0, length: textStorage?.length ?? 0))
    return clamped.length > 0 ? clamped : nil
  }

  private func redisplay(_ range: NSRange) {
    if let range = existing(range) {
      invalidateDisplay(forCharacterRange: range)
    }
  }

  override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    guard !hiddenRanges.isEmpty else {
      super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin)
      return
    }
    let hidden = hiddenRanges
      .compactMap(existing)
      .map { glyphRange(forCharacterRange: $0, actualCharacterRange: nil) }
      .sorted { $0.location < $1.location }
    // 감춘 범위를 뺀 나머지만 그린다.
    var location = glyphsToShow.location
    let end = NSMaxRange(glyphsToShow)
    for range in hidden where location < end {
      if range.location > location {
        super.drawGlyphs(forGlyphRange: NSRange(location: location, length: min(range.location, end) - location), at: origin)
      }
      location = max(location, NSMaxRange(range))
    }
    if location < end {
      super.drawGlyphs(forGlyphRange: NSRange(location: location, length: end - location), at: origin)
    }
  }
}

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

/// 키보드 위 컨트롤 바(RN InputAccessoryView의 내용 뷰)의 높이를 제 안전 영역에서 떼어 낸다.
///
/// RN은 내용을 담은 컨테이너를 내용 뷰의 safeAreaLayoutGuide 위아래에 붙여, 컨트롤 바 높이가 '내용 + 제 아래 안전 영역'이 된다.
/// 키보드를 천천히 끌어 내려 컨트롤 바가 홈 인디케이터 자리 경계에 걸치면 안전 영역이 높이를, 높이가 키보드 창 안의 위치를,
/// 위치가 다시 안전 영역을 바꿔 키보드 창의 레이아웃이 끝나지 않는다. (앱이 멈추고 키보드가 그 자리에 선다)
/// 그래서 컨테이너를 내용 뷰 위아래에 바로 붙이고, 홈 인디케이터 자리는 키보드 알림으로 정한 고정 여백으로 비운다.
private enum AccessoryLayout {
  static let topID = "MemoAccessory.top"
  static let bottomID = "MemoAccessory.bottom"

  /// 안전 영역 위아래에 붙은 제약을 내용 뷰 가장자리에 붙는 제약으로 바꾼다. 이미 바꿨으면 바꿀 제약이 없다.
  static func detachFromSafeArea(_ accessory: UIView) {
    let guide = accessory.safeAreaLayoutGuide
    for constraint in accessory.constraints where constraint.isActive {
      guard let (content, attribute) = edge(of: constraint, pinnedTo: guide) else { continue }
      constraint.isActive = false
      let pinned = attribute == .top
        ? content.topAnchor.constraint(equalTo: accessory.topAnchor)
        : content.bottomAnchor.constraint(equalTo: accessory.bottomAnchor)
      pinned.identifier = attribute == .top ? topID : bottomID
      pinned.priority = constraint.priority
      pinned.isActive = true
    }
  }

  /// 컨테이너 아래에 둘 여백. 컨트롤 바 높이는 '내용 + inset'이다.
  static func setBottomInset(_ inset: CGFloat, of accessory: UIView) {
    guard let bottom = accessory.constraints.first(where: { $0.identifier == bottomID }),
          bottom.constant != -inset else { return }
    bottom.constant = -inset
  }

  /// guide의 위나 아래에 같게 붙은 제약이면 붙은 뷰와 그 가장자리
  private static func edge(
    of constraint: NSLayoutConstraint, pinnedTo guide: UILayoutGuide
  ) -> (UIView, NSLayoutConstraint.Attribute)? {
    let attribute = constraint.firstAttribute
    guard constraint.relation == .equal, constraint.multiplier == 1, constraint.constant == 0,
          attribute == constraint.secondAttribute, attribute == .top || attribute == .bottom else { return nil }
    if constraint.secondItem === guide, let view = constraint.firstItem as? UIView { return (view, attribute) }
    if constraint.firstItem === guide, let view = constraint.secondItem as? UIView { return (view, attribute) }
    return nil
  }
}

final class MemoTextView: UITextView {
  weak var editor: MemoEditorView?
  let markerView = MemoMarkerView()
  let placeholderLabel = UILabel()
  let checkboxTap = UITapGestureRecognizer()
  let memoUndoManager = MemoUndoManager()

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
    get { formatBarAccessory() }
    set { accessory = newValue }
  }

  /// 제목 칸과 함께 쓰는 컨트롤 바. 처음 찾을 때 높이를 제 안전 영역에서 떼어 둔다. (AccessoryLayout)
  func formatBarAccessory() -> UIView? {
    if accessory == nil, let accessoryID, let window,
       let found = Self.accessoryView(nativeID: accessoryID, in: window) {
      AccessoryLayout.detachFromSafeArea(found)
      accessory = found
    }
    return accessory
  }

  /// 화면 키보드는 이보다 높다. 키보드 높이에서 컨트롤 바를 뺀 것이 이보다 낮으면 컨트롤 바만 떠 있다.
  private static let minimumKeyboardHeight: CGFloat = 100

  /// 키보드 알림 때 컨트롤 바 아래에 화면 키보드가 없으면(하드웨어 키보드) 컨트롤 바가 화면 아래에 붙으므로
  /// 홈 인디케이터 자리를 비운다. 알림 때의 크기로만 정해 키보드를 끌어 내리는 동안에는 바뀌지 않고,
  /// 여백을 바꿔 다시 오는 알림에서도 여백 크기만큼의 차이로는 판단이 뒤집히지 않는다.
  func updateAccessoryBottomInset(keyboardFrame: CGRect) {
    guard keyboardFrame.height > 0, let window, let accessory = formatBarAccessory() else { return }
    let barOnly = keyboardFrame.height - accessory.bounds.height < Self.minimumKeyboardHeight
    AccessoryLayout.setBottomInset(barOnly ? window.safeAreaInsets.bottom : 0, of: accessory)
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

