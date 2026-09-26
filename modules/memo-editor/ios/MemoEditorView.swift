import ExpoModulesCore
import UIKit

/// 되돌리기 단계를 나누는 기준
private enum EditKind {
  /// 한 글자 치기·지우기와 한글 조합. 잠깐 멈추기 전까지 한 단계로 합친다.
  case typing
  /// 줄 바꿈. 새 단계를 열고 이어서 치는 글자를 합친다.
  case newline
  /// 붙여넣기, 자동 고침, 서식, 목록, 체크처럼 따로 되돌리는 편집
  case command
}

final class MemoEditorView: ExpoView, UITextViewDelegate, NSTextStorageDelegate {
  let onChangeContent = EventDispatcher()
  let onChangeFormat = EventDispatcher()
  let onChangeHistory = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onLeaveParagraph = EventDispatcher()

  private static let typingPause: CFTimeInterval = 1.0
  private static let historyLimit = 100

  let textView: MemoTextView
  private let layoutManager: NSLayoutManager
  private let textContainer: NSTextContainer

  var theme = MemoTheme() {
    didSet { needsRestyle = true }
  }
  var placeholder = "" {
    didSet { textView.placeholderLabel.text = placeholder }
  }
  var autoFocus = false
  var insetHorizontal: CGFloat = 20 {
    didSet { updateInsets() }
  }
  var insetTop: CGFloat = 14 {
    didSet { updateInsets() }
  }
  /// 이 화면을 밀어 뒤로 갈 때, 손을 떼 넘어가기로 정해지는 순간 가볍게 울린다.
  var swipeBackHaptic = false {
    didSet { updateSwipeBackHaptic() }
  }
  private let swipeBackHaptics = SwipeBackHaptics()

  /// 글자가 하나도 없는 마지막 빈 줄의 문단 종류. 붙일 글자가 없어 따로 기억한다.
  private(set) var trailingBlock: MemoBlock = .paragraph

  private var pendingContent: String?
  private var didLoadContent = false
  private var didAutoFocus = false
  private var needsRestyle = true
  private var editedRange: NSRange?
  private var pendingContinuation: MemoBlock?
  private var pendingStamp: (before: NSString, attributes: [NSAttributedString.Key: Any])?
  private var lastContent: String?
  private var lastFormat: (inline: InlineFlags, block: MemoBlock)?
  /// 커서가 있는 문단. 고친 문단에서 커서가 떠나면 JS에 알린다. (할 일 자동 감지)
  private var activeParagraph: (index: Int, text: String, edited: Bool)?

  /// 되돌리기 기록. 단계마다 문서 전체(저장 형식 JSON)를 남기고, historyIndex가 지금 문서다.
  private var history: [String] = []
  private var historyIndex = 0
  /// 마지막 단계가 타이핑이면 잠깐 멈추기 전까지 이어지는 타이핑을 그 단계에 합친다.
  private var typingStepOpen = false
  private var lastTypingAt: CFTimeInterval = 0
  private var pendingEditKind = EditKind.typing
  private var lastHistoryState: (canUndo: Bool, canRedo: Bool)?

  var canUndo: Bool { historyIndex > 0 }
  var canRedo: Bool { historyIndex < history.count - 1 }

  private var storage: NSTextStorage { textView.textStorage }
  private var string: NSString { textView.textStorage.string as NSString }

  required init(appContext: AppContext? = nil) {
    let textStorage = NSTextStorage()
    let layoutManager = NSLayoutManager()
    textStorage.addLayoutManager(layoutManager)
    let textContainer = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    textContainer.widthTracksTextView = true
    textContainer.lineFragmentPadding = 0
    layoutManager.addTextContainer(textContainer)
    self.layoutManager = layoutManager
    self.textContainer = textContainer
    // TextKit 1로 만들어 줄 위치를 직접 계산하고 마커를 그린다.
    self.textView = MemoTextView(frame: .zero, textContainer: textContainer)
    super.init(appContext: appContext)

    textStorage.delegate = self
    textView.editor = self
    textView.markerView.editor = self
    textView.memoUndoManager.editor = self
    textView.delegate = self
    textView.backgroundColor = .clear
    textView.alwaysBounceVertical = true
    textView.keyboardDismissMode = .interactive
    textView.contentInsetAdjustmentBehavior = .never
    textView.checkboxTap.addTarget(self, action: #selector(handleCheckboxTap(_:)))
    updateInsets()
    addSubview(textView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if textView.frame != bounds {
      textView.frame = bounds
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    focusIfNeeded()
    updateSwipeBackHaptic()
  }

  private func updateSwipeBackHaptic() {
    if swipeBackHaptic, window != nil, let screen = owningViewController {
      swipeBackHaptics.attach(to: screen)
    } else {
      swipeBackHaptics.detach()
    }
  }

  private var owningViewController: UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let controller = current as? UIViewController { return controller }
      responder = current.next
    }
    return nil
  }

  // MARK: - Props

  func setInitialContent(_ json: String?) {
    guard !didLoadContent else { return }
    pendingContent = json ?? ""
  }

  func didUpdateProps() {
    if needsRestyle {
      needsRestyle = false
      applyTheme()
    }
    if !didLoadContent {
      didLoadContent = true
      load(pendingContent ?? "")
      pendingContent = nil
    }
    focusIfNeeded()
  }

  private func updateInsets() {
    textView.textContainerInset = UIEdgeInsets(top: insetTop, left: insetHorizontal, bottom: 24, right: insetHorizontal)
  }

  private func applyTheme() {
    textView.tintColor = theme.accentColor
    textView.placeholderLabel.font = theme.font(bold: false)
    textView.placeholderLabel.textColor = theme.placeholderColor
    if storage.length > 0 {
      storage.beginEditing()
      storage.enumerateAttributes(in: NSRange(location: 0, length: storage.length)) { attributes, range, _ in
        let block = MemoBlock(paragraphStyle: attributes[.paragraphStyle])
        storage.setAttributes(theme.attributes(block: block, inline: InlineFlags(attributes)), range: range)
      }
      storage.endEditing()
    }
    syncTypingAttributes()
    refreshDecorations()
  }

  private func load(_ json: String) {
    let parsed = MemoDocument.deserialize(json, theme: theme)
    storage.setAttributedString(parsed?.text ?? NSAttributedString())
    trailingBlock = parsed?.trailingBlock ?? .paragraph
    editedRange = nil
    textView.selectedRange = NSRange(location: storage.length, length: 0)
    let content = MemoDocument.serialize(storage, trailingBlock: trailingBlock)
    lastContent = content
    history = [content]
    historyIndex = 0
    typingStepOpen = false
    syncTypingAttributes()
    refreshDecorations()
    emitFormat()
    emitHistory()
  }

  private func focusIfNeeded() {
    guard autoFocus, !didAutoFocus, didLoadContent, window != nil else { return }
    didAutoFocus = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.textView.becomeFirstResponder()
      self.textView.selectedRange = NSRange(location: self.storage.length, length: 0)
      self.textView.scrollCaretIntoView()
    }
  }

  // MARK: - Commands

  func focus() {
    textView.becomeFirstResponder()
  }

  func blur() {
    textView.resignFirstResponder()
  }

  func toggleInline(_ flag: WritableKeyPath<InlineFlags, Bool>) {
    endKeyboardComposition()
    let selection = textView.selectedRange

    if selection.length > 0 {
      let turnOn = !selectionFlags(selection)[keyPath: flag]
      storage.beginEditing()
      storage.enumerateAttributes(in: selection) { attributes, range, _ in
        var flags = InlineFlags(attributes)
        flags[keyPath: flag] = turnOn
        applyInline(flags, to: range)
      }
      storage.endEditing()
      emitContentIfChanged()
    } else {
      // 선택 영역이 없으면 다음에 입력할 글자의 서식만 바꾼다.
      var flags = InlineFlags(textView.typingAttributes)
      flags[keyPath: flag].toggle()
      let block = blockOf(string.memoParagraph(at: selection.location))
      textView.typingAttributes = theme.attributes(block: block, inline: flags)
    }
    emitFormat()
  }

  func toggleBlock(named name: String) {
    guard let block = MemoBlock(rawValue: name), block.isList, block != .checked else { return }
    endKeyboardComposition()

    let paragraphs = paragraphs(touching: textView.selectedRange)
    let allMatch = paragraphs.allSatisfy { blockOf($0).kind == block }
    storage.beginEditing()
    for paragraph in paragraphs {
      let current = blockOf(paragraph)
      if allMatch {
        setBlock(.paragraph, for: paragraph)
      } else if !(block == .checkbox && current.isCheckbox) {
        setBlock(block, for: paragraph)
      }
    }
    storage.endEditing()
    structureDidChange()
  }

  /// 문단마다 내용이 text이고 종류가 from일 때만 to로 바꾼다. 한 번에 바꾼 것은 되돌리기 한 번으로 돌아간다.
  /// 커서와 스크롤은 그대로 둔다. 바꾼 문단마다 true를 돌려준다.
  func setParagraphBlocks(_ changes: [ParagraphBlockChange]) -> [Bool] {
    let paragraphs = string.memoParagraphs()
    let targets: [(paragraph: NSRange, block: MemoBlock)?] = changes.map { change in
      guard let from = MemoBlock(rawValue: change.from),
            let to = MemoBlock(rawValue: change.to),
            change.index >= 0, change.index < paragraphs.count else { return nil }
      let paragraph = paragraphs[change.index]
      guard paragraph.length > 0,
            contentText(of: paragraph) == change.text,
            blockOf(paragraph).kind == from.kind else { return nil }
      return (paragraph, to)
    }
    let applied = targets.map { $0 != nil }
    guard applied.contains(true) else { return applied }

    endKeyboardComposition()
    let selection = textView.selectedRange
    let offset = textView.contentOffset
    storage.beginEditing()
    for case let target? in targets {
      setBlock(target.block, for: target.paragraph)
    }
    storage.endEditing()
    textView.selectedRange = selection
    textView.contentOffset = offset
    structureDidChange()
    return applied
  }

  func undo() {
    guard canUndo else { return }
    restoreHistory(at: historyIndex - 1)
  }

  func redo() {
    guard canRedo else { return }
    restoreHistory(at: historyIndex + 1)
  }

  /// 기록의 index번째 문서로 돌아간다. 글자가 바뀌었으면 바뀐 곳으로 커서를 옮기고,
  /// 서식만 바뀌었으면(할 일로 바꾼 것을 되돌릴 때) 커서와 스크롤을 그대로 둔다. 포커스는 건드리지 않는다.
  private func restoreHistory(at index: Int) {
    guard let parsed = MemoDocument.deserialize(history[index], theme: theme) else { return }
    endKeyboardComposition()
    let before = string.copy() as! NSString
    let selection = textView.selectedRange
    let offset = textView.contentOffset
    historyIndex = index
    typingStepOpen = false
    // 되돌아온 문단을 고친 문단으로 치면 커서가 떠날 때 할 일로 다시 바뀐다.
    activeParagraph = nil
    pendingStamp = nil
    pendingContinuation = nil

    textView.inputDelegate?.textWillChange(textView)
    storage.setAttributedString(parsed.text)
    textView.inputDelegate?.textDidChange(textView)
    trailingBlock = parsed.trailingBlock
    editedRange = nil

    if before.isEqual(to: string as String) {
      let location = min(selection.location, storage.length)
      textView.selectedRange = NSRange(location: location, length: min(selection.length, storage.length - location))
      textView.contentOffset = offset
    } else {
      let changed = changedRange(from: before, to: string)
      textView.selectedRange = NSRange(location: NSMaxRange(changed), length: 0)
      textView.scrollRangeToVisible(changed)
    }
    syncTypingAttributes()
    refreshDecorations()
    let content = MemoDocument.serialize(storage, trailingBlock: trailingBlock)
    lastContent = content
    onChangeContent(["content": content, "fromHistory": true])
    emitFormat()
    emitHistory()
    if textView.isFirstResponder {
      trackActiveParagraph(edited: false)
    }
  }

  @objc private func handleCheckboxTap(_ gesture: UITapGestureRecognizer) {
    guard gesture.state == .ended, let paragraph = checkboxParagraph(at: gesture.location(in: textView)) else { return }
    storage.beginEditing()
    setBlock(blockOf(paragraph) == .checked ? .checkbox : .checked, for: paragraph)
    storage.endEditing()
    structureDidChange()
  }

  // MARK: - UITextViewDelegate

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    let string = self.string
    pendingEditKind = editKind(replacing: range, with: text)

    if text == "\n" && range.length == 0 {
      let paragraph = string.memoParagraph(at: range.location)
      let block = blockOf(paragraph)
      if block.isList && string.memoContentRange(of: paragraph).length == 0 {
        // 빈 목록 줄에서 엔터를 누르면 줄을 늘리지 않고 목록만 끝낸다.
        setBlock(.paragraph, for: paragraph)
        structureDidChange()
        return false
      }
      pendingContinuation = block.continuation
      return true
    }

    if text.isEmpty && range.length == 1
      && textView.selectedRange == NSRange(location: range.location + 1, length: 0)
      && string.character(at: range.location) == 0x0A {
      // 목록 줄 맨 앞에서 지우면 윗줄과 합치지 않고 목록 표시만 없앤다.
      let paragraph = string.memoParagraph(at: range.location + 1)
      if blockOf(paragraph).isList {
        setBlock(.paragraph, for: paragraph)
        structureDidChange()
        return false
      }
    }

    if text.isEmpty && range.length > 0 && NSMaxRange(range) == string.length {
      // 마지막 문단의 글자를 모두 지우면 빈 줄이 그 문단 종류를 이어받는다.
      let start = range.location
      if start == 0 || string.character(at: start - 1) == 0x0A {
        trailingBlock = blockOf(string.memoParagraph(at: start))
      }
    }

    if !text.isEmpty {
      // 한글 키보드는 자모를 넣은 뒤 앞 글자와 합쳐 음절을 만드는데, 합쳐진 음절은 그 앞 글자의
      // 서식을 가져간다. 입력하려던 서식을 기억했다가 textViewDidChange에서 바뀐 글자에 다시 입힌다.
      let replacesText = range.length > 0 && range.location < storage.length
      let attributes = replacesText ? storage.attributes(at: range.location, effectiveRange: nil) : textView.typingAttributes
      // NSTextStorage.string은 내부 가변 문자열을 그대로 돌려주므로 편집 전 상태를 복사해 둔다.
      pendingStamp = (string.copy() as! NSString, attributes)
    }

    return true
  }

  func textViewDidChange(_ textView: UITextView) {
    let kind = pendingEditKind
    pendingEditKind = .typing
    if let stamp = pendingStamp {
      pendingStamp = nil
      let changed = changedRange(from: stamp.before, to: string)
      if changed.length > 0 {
        let block = MemoBlock(paragraphStyle: stamp.attributes[.paragraphStyle])
        storage.setAttributes(theme.attributes(block: block, inline: InlineFlags(stamp.attributes)), range: changed)
      }
    }
    if let continuation = pendingContinuation {
      pendingContinuation = nil
      setBlock(continuation, for: string.memoParagraph(at: textView.selectedRange.location))
    }
    normalizeEditedParagraphs()
    syncTypingAttributes()
    refreshDecorations()
    emitContentIfChanged(kind)
    emitFormat()
    trackActiveParagraph(edited: true)
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    syncTypingAttributes()
    emitFormat()
    if textView.isFirstResponder {
      trackActiveParagraph(edited: false)
    }
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onFocusChange(["focused": true])
    trackActiveParagraph(edited: false)
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    leaveActiveParagraph()
    onFocusChange(["focused": false])
  }

  // MARK: - NSTextStorageDelegate

  func textStorage(
    _ textStorage: NSTextStorage,
    didProcessEditing editedMask: NSTextStorage.EditActions,
    range editedRange: NSRange,
    changeInLength delta: Int
  ) {
    guard editedMask.contains(.editedCharacters) else { return }
    if let previous = self.editedRange, NSMaxRange(previous) <= textStorage.length {
      self.editedRange = NSUnionRange(previous, editedRange)
    } else {
      self.editedRange = editedRange
    }
  }

  // MARK: - Editing helpers

  /// 한글 키보드는 marked text 없이 직전 글자를 바꿔 치우며 조합한다.
  /// 서식을 바꾸기 전에 선택이 바뀌었다고 알려 조합을 끝내야 다음 자모가 앞 글자에 붙지 않는다.
  private func endKeyboardComposition() {
    if textView.markedTextRange != nil {
      textView.unmarkText()
    }
    textView.inputDelegate?.selectionWillChange(textView)
    textView.inputDelegate?.selectionDidChange(textView)
  }

  /// 글자가 하나씩 늘거나 주는 편집(한글 조합 포함)은 타이핑, 줄 바꿈은 새 단계,
  /// 여러 글자가 한꺼번에 늘거나 주는 편집(붙여넣기, 선택 지우기)은 따로 되돌린다.
  private func editKind(replacing range: NSRange, with text: String) -> EditKind {
    if text == "\n" && range.length == 0 { return .newline }
    if text.contains("\n") { return .command }
    let grown = text.count - string.substring(with: range).count
    return abs(grown) > 1 ? .command : .typing
  }

  /// 편집 전후 문자열을 비교해 새 문자열에서 바뀐 구간을 구한다.
  private func changedRange(from old: NSString, to new: NSString) -> NSRange {
    let oldLength = old.length
    let newLength = new.length
    var prefix = 0
    while prefix < min(oldLength, newLength) && old.character(at: prefix) == new.character(at: prefix) {
      prefix += 1
    }
    var suffix = 0
    while suffix < min(oldLength, newLength) - prefix
      && old.character(at: oldLength - 1 - suffix) == new.character(at: newLength - 1 - suffix) {
      suffix += 1
    }
    return NSRange(location: prefix, length: newLength - prefix - suffix)
  }

  private func contentText(of paragraph: NSRange) -> String {
    string.substring(with: string.memoContentRange(of: paragraph))
  }

  private func paragraphIndex(at location: Int) -> Int {
    let string = self.string
    let end = min(location, string.length)
    var index = 0
    for i in 0..<end where string.character(at: i) == 0x0A {
      index += 1
    }
    return index
  }

  private func trackActiveParagraph(edited: Bool) {
    let location = textView.selectedRange.location
    let index = paragraphIndex(at: location)
    if let active = activeParagraph, active.index != index {
      leaveActiveParagraph()
    }
    let wasEdited = activeParagraph?.edited ?? false
    activeParagraph = (index, contentText(of: string.memoParagraph(at: location)), wasEdited || edited)
  }

  /// 고친 일반 문단에서 커서가 떠났으면 그 문단을 알린다. 줄 나누기·합치기로 내용이 바뀌었으면 알리지 않는다.
  private func leaveActiveParagraph() {
    guard let active = activeParagraph else { return }
    activeParagraph = nil
    guard active.edited else { return }
    let paragraphs = string.memoParagraphs()
    guard active.index < paragraphs.count else { return }
    let paragraph = paragraphs[active.index]
    let text = contentText(of: paragraph)
    guard text == active.text,
          blockOf(paragraph) == .paragraph,
          !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    onLeaveParagraph(["index": active.index, "text": text])
  }

  private func blockOf(_ paragraph: NSRange) -> MemoBlock {
    paragraph.length == 0 ? trailingBlock : MemoDocument.block(in: storage, at: paragraph.location)
  }

  private func setBlock(_ block: MemoBlock, for paragraph: NSRange) {
    guard paragraph.length > 0 else {
      trailingBlock = block
      return
    }
    storage.addAttribute(.paragraphStyle, value: theme.paragraphStyle(for: block), range: paragraph)
    storage.addAttribute(.foregroundColor, value: theme.color(for: block), range: paragraph)
  }

  private func paragraphs(touching selection: NSRange) -> [NSRange] {
    if selection.length == 0 {
      return [string.memoParagraph(at: selection.location)]
    }
    let end = NSMaxRange(selection)
    return string.memoParagraphs().filter {
      $0.length > 0 && $0.location < end && selection.location < NSMaxRange($0)
    }
  }

  private func applyInline(_ flags: InlineFlags, to range: NSRange) {
    storage.addAttribute(.font, value: theme.font(bold: flags.bold), range: range)
    if flags.underline {
      storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
    } else {
      storage.removeAttribute(.underlineStyle, range: range)
    }
    if flags.strikethrough {
      storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: range)
    } else {
      storage.removeAttribute(.strikethroughStyle, range: range)
    }
  }

  /// 선택한 글자 전체에 걸린 서식. 줄바꿈 문자는 판단에서 뺀다.
  private func selectionFlags(_ selection: NSRange) -> InlineFlags {
    let string = self.string
    var result = InlineFlags(bold: true, underline: true, strikethrough: true)
    var sawText = false
    storage.enumerateAttributes(in: selection) { attributes, range, _ in
      if string.substring(with: range).allSatisfy({ $0 == "\n" }) { return }
      sawText = true
      let flags = InlineFlags(attributes)
      result.bold = result.bold && flags.bold
      result.underline = result.underline && flags.underline
      result.strikethrough = result.strikethrough && flags.strikethrough
    }
    return sawText ? result : InlineFlags(textView.typingAttributes)
  }

  /// 편집된 문단 안의 글자들이 모두 같은 문단 서식을 갖도록 맞춘다. (줄 합치기, 붙여넣기 등)
  private func normalizeEditedParagraphs() {
    guard let edited = editedRange else { return }
    editedRange = nil
    let string = self.string
    let start = min(edited.location, string.length)
    let end = min(NSMaxRange(edited), string.length)
    let span = string.paragraphRange(for: NSRange(location: start, length: end - start))
    guard span.length > 0 else { return }

    storage.beginEditing()
    var location = span.location
    while location < NSMaxRange(span) {
      let paragraph = string.paragraphRange(for: NSRange(location: location, length: 0))
      let block = blockOf(paragraph)
      let style = theme.paragraphStyle(for: block)
      let color = theme.color(for: block)
      storage.enumerateAttributes(in: paragraph) { attributes, range, _ in
        if !theme.isCanonical(attributes[.paragraphStyle] as? NSParagraphStyle, for: block) {
          storage.addAttribute(.paragraphStyle, value: style, range: range)
        }
        if (attributes[.foregroundColor] as? UIColor) != color {
          storage.addAttribute(.foregroundColor, value: color, range: range)
        }
        if attributes[.font] == nil {
          storage.addAttribute(.font, value: theme.font(bold: false), range: range)
        }
      }
      location = NSMaxRange(paragraph)
    }
    storage.endEditing()
  }

  private func syncTypingAttributes() {
    let selection = textView.selectedRange
    let string = self.string
    let paragraph = string.memoParagraph(at: selection.location)
    var inline = InlineFlags(textView.typingAttributes)
    // UIKit은 윗줄 줄바꿈까지 거슬러 서식을 가져오므로, 같은 문단 안의 바로 앞 글자(문단 첫머리면 첫 글자)를 따른다.
    if selection.length == 0 && paragraph.length > 0 {
      if selection.location > paragraph.location {
        inline = InlineFlags(storage.attributes(at: selection.location - 1, effectiveRange: nil))
      } else if string.character(at: paragraph.location) != 0x0A {
        inline = InlineFlags(storage.attributes(at: paragraph.location, effectiveRange: nil))
      }
    }
    textView.typingAttributes = theme.attributes(block: blockOf(paragraph), inline: inline)
  }

  private func structureDidChange() {
    syncTypingAttributes()
    refreshDecorations()
    emitContentIfChanged()
    emitFormat()
  }

  private func refreshDecorations() {
    textView.placeholderLabel.isHidden = storage.length > 0 || trailingBlock != .paragraph
    textView.markerView.setNeedsDisplay()
    textView.setNeedsLayout()
    if #available(iOS 17.0, *) {
      for case let interaction as UITextSelectionDisplayInteraction in textView.interactions {
        interaction.setNeedsSelectionUpdate()
      }
    }
  }

  private func emitContentIfChanged(_ kind: EditKind = .command) {
    let content = MemoDocument.serialize(storage, trailingBlock: trailingBlock)
    guard content != lastContent else { return }
    lastContent = content
    record(content, kind: kind)
    onChangeContent(["content": content, "fromHistory": false])
  }

  /// 바뀐 문서를 되돌리기 기록에 남긴다. 되돌린 뒤 새로 고치면 다시 하기 기록은 버린다.
  private func record(_ content: String, kind: EditKind) {
    let now = CACurrentMediaTime()
    guard !history.isEmpty else {
      history = [content]
      historyIndex = 0
      return
    }
    history.removeSubrange((historyIndex + 1)...)
    if kind == .typing && typingStepOpen && now - lastTypingAt < Self.typingPause {
      history[historyIndex] = content
    } else {
      history.append(content)
      if history.count > Self.historyLimit {
        history.removeFirst(history.count - Self.historyLimit)
      }
      historyIndex = history.count - 1
    }
    typingStepOpen = kind != .command
    lastTypingAt = now
    emitHistory()
  }

  private func emitHistory() {
    let state = (canUndo: canUndo, canRedo: canRedo)
    if let last = lastHistoryState, last == state { return }
    lastHistoryState = state
    onChangeHistory(["canUndo": state.canUndo, "canRedo": state.canRedo])
  }

  private func emitFormat() {
    let selection = textView.selectedRange
    let inline = selection.length > 0 ? selectionFlags(selection) : InlineFlags(textView.typingAttributes)
    let block = blockOf(string.memoParagraph(at: selection.location)).kind
    if let last = lastFormat, last.inline == inline, last.block == block { return }
    lastFormat = (inline, block)
    onChangeFormat([
      "bold": inline.bold,
      "underline": inline.underline,
      "strikethrough": inline.strikethrough,
      "block": block.rawValue,
    ])
  }

  // MARK: - Markers

  private func firstLineRect(of paragraph: NSRange) -> CGRect? {
    layoutManager.ensureLayout(for: textContainer)
    if paragraph.length == 0 {
      let rect = layoutManager.extraLineFragmentRect
      return rect.height > 0 ? rect : nil
    }
    let glyph = layoutManager.glyphIndexForCharacter(at: paragraph.location)
    return layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
  }

  func checkboxParagraph(at point: CGPoint) -> NSRange? {
    let inset = textView.textContainerInset
    let x = point.x - inset.left
    guard x >= -14 && x <= theme.listIndent else { return nil }
    for paragraph in string.memoParagraphs() where blockOf(paragraph).isCheckbox {
      guard let line = firstLineRect(of: paragraph) else { continue }
      let top = inset.top + line.minY
      if point.y >= top - 6 && point.y <= top + theme.lineHeight + 6 {
        return paragraph
      }
    }
    return nil
  }

  func drawMarkers(in dirtyRect: CGRect) {
    let inset = textView.textContainerInset
    var number = 0
    for paragraph in string.memoParagraphs() {
      let block = blockOf(paragraph)
      number = block == .number ? number + 1 : 0
      guard block.isList, let line = firstLineRect(of: paragraph) else { continue }
      let top = inset.top + line.minY
      guard top <= dirtyRect.maxY && top + theme.lineHeight >= dirtyRect.minY else { continue }
      drawMarker(block, number: number, top: top, left: inset.left)
    }
  }

  private func drawMarker(_ block: MemoBlock, number: Int, top: CGFloat, left: CGFloat) {
    let centerY = top + theme.lineHeight / 2
    switch block {
    case .checkbox, .checked:
      let size = theme.markerSize
      let box = CGRect(x: left + 1, y: centerY - size / 2, width: size, height: size)
      let radius = size * 0.28
      if block == .checked {
        theme.accentColor.setFill()
        UIBezierPath(roundedRect: box, cornerRadius: radius).fill()
        let check = UIBezierPath()
        check.move(to: CGPoint(x: box.minX + size * 0.26, y: box.minY + size * 0.52))
        check.addLine(to: CGPoint(x: box.minX + size * 0.43, y: box.minY + size * 0.69))
        check.addLine(to: CGPoint(x: box.minX + size * 0.75, y: box.minY + size * 0.33))
        check.lineWidth = 2
        check.lineCapStyle = .round
        check.lineJoinStyle = .round
        UIColor.white.setStroke()
        check.stroke()
      } else {
        let outline = UIBezierPath(roundedRect: box.insetBy(dx: 0.75, dy: 0.75), cornerRadius: radius)
        outline.lineWidth = 1.5
        theme.mutedColor.setStroke()
        outline.stroke()
      }
    case .bullet:
      let diameter: CGFloat = round(theme.fontSize / 3)
      theme.textColor.setFill()
      UIBezierPath(ovalIn: CGRect(x: left + 7, y: centerY - diameter / 2, width: diameter, height: diameter)).fill()
    case .number:
      let label = "\(number)." as NSString
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.monospacedDigitSystemFont(ofSize: theme.fontSize, weight: .regular),
        .foregroundColor: theme.textColor,
      ]
      let size = label.size(withAttributes: attributes)
      let right = left + theme.listIndent - 8
      label.draw(at: CGPoint(x: right - size.width, y: centerY - size.height / 2), withAttributes: attributes)
    case .paragraph:
      break
    }
  }
}

/// 내비게이션의 뒤로 가기 스와이프(가장자리, iOS 26부터는 화면 어디서든)에서 손을 떼
/// 넘어가기로 정해지는 순간 울린다. 전환이 끝난 뒤에 울리면 한 박자 늦게 느껴진다.
final class SwipeBackHaptics: NSObject {
  private weak var screen: UIViewController?
  private weak var navigationController: UINavigationController?
  private var recognizers: [UIGestureRecognizer] = []
  private let generator = UIImpactFeedbackGenerator(style: .light)

  func attach(to screen: UIViewController) {
    guard let navigationController = screen.navigationController else { return }
    if self.screen === screen && self.navigationController === navigationController { return }
    detach()
    self.screen = screen
    self.navigationController = navigationController
    var recognizers = [navigationController.interactivePopGestureRecognizer].compactMap { $0 }
    if #available(iOS 26.0, *), let content = navigationController.interactiveContentPopGestureRecognizer {
      recognizers.append(content)
    }
    for recognizer in recognizers {
      recognizer.addTarget(self, action: #selector(handle(_:)))
    }
    self.recognizers = recognizers
  }

  // 제스처는 target을 붙잡아 두지 않으므로 사라지기 전에 반드시 떼어 낸다.
  func detach() {
    for recognizer in recognizers {
      recognizer.removeTarget(self, action: #selector(handle(_:)))
    }
    recognizers = []
    screen = nil
    navigationController = nil
  }

  deinit {
    detach()
  }

  // UIKit이 먼저 같은 제스처로 뒤로 가기 전환을 시작하므로, began 시점에는 전환 정보가 있다.
  @objc private func handle(_ recognizer: UIGestureRecognizer) {
    guard recognizer.state == .began,
          let coordinator = navigationController?.transitionCoordinator,
          coordinator.viewController(forKey: .from) === screen else { return }
    generator.prepare()
    coordinator.notifyWhenInteractionChanges { [weak self] context in
      if !context.isCancelled {
        self?.generator.impactOccurred()
      }
    }
  }
}
