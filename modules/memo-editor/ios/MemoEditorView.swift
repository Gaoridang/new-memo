import ExpoModulesCore
import UIKit

/// 되돌리기 한 단계에 담기는 편집의 종류
private enum EditKind {
  /// 글자 치기(한글 조합 포함). 낱말 하나를 한 단계로 묶는다.
  case typing
  /// 한 글자씩 지우기. 이어서 지우는 동안 한 단계로 묶는다.
  case deleting
  /// 줄 바꿈. 한 단계를 따로 차지한다.
  case newline
  /// 붙여넣기, 자동 고침, 서식, 목록, 체크, 자동 변환처럼 따로 되돌리는 편집
  case command
}

private func isSpace(_ character: unichar) -> Bool {
  guard let scalar = Unicode.Scalar(character) else { return false }
  return CharacterSet.whitespacesAndNewlines.contains(scalar)
}

/// 사용자가 한 번에 고친 글자. 위치는 편집 전 글 기준이다.
private struct TextEdit {
  let kind: EditKind
  let range: NSRange
  /// 새로 들어간 글자 길이 (UTF-16)
  let insertedLength: Int
  /// 띄어 쓴 뒤 새 낱말을 쓰기 시작하는 편집
  let startsWord: Bool
  /// 공백이 아닌 글자가 들어가는 편집
  let insertsWordCharacters: Bool

  /// 글자가 하나씩 늘거나 주는 편집(한글 조합 포함)은 치기·지우기, 줄 바꿈은 따로,
  /// 여러 글자가 한꺼번에 늘거나 주는 편집(붙여넣기, 선택 지우기, 자동 고침)은 명령으로 본다.
  init(in text: NSString, replacing range: NSRange, with replacement: String) {
    let removed = text.substring(with: range)
    if replacement == "\n" && range.length == 0 {
      kind = .newline
    } else if replacement.contains("\n") || abs(replacement.count - removed.count) > 1 {
      kind = .command
    } else if replacement.isEmpty {
      kind = .deleting
    } else {
      kind = .typing
    }
    self.range = range
    let inserted = replacement as NSString
    insertedLength = inserted.length
    insertsWordCharacters = (0..<inserted.length).contains { !isSpace(inserted.character(at: $0)) }
    startsWord = range.length == 0 && inserted.length > 0 && !isSpace(inserted.character(at: 0))
      && (range.location == 0 || isSpace(text.character(at: range.location - 1)))
  }
}

/// 이어 쓰는 중인 되돌리기 단계. 위치는 지금 글 기준이다.
private struct OpenStep {
  let kind: EditKind
  var start: Int
  var end: Int
  var hasWordCharacters: Bool

  /// 치기나 지우기만 다음 편집을 이어 받는다. 줄 바꿈과 명령은 단계를 바로 닫는다.
  init?(beginning edit: TextEdit) {
    switch edit.kind {
    case .typing:
      kind = .typing
      start = edit.range.location
      end = edit.range.location + edit.insertedLength
      hasWordCharacters = edit.insertsWordCharacters
    case .deleting:
      kind = .deleting
      start = edit.range.location
      end = edit.range.location
      hasWordCharacters = false
    case .newline, .command:
      return nil
    }
  }

  /// 방금 쓰던 자리에 바로 이어지는 편집인가
  func continues(with edit: TextEdit) -> Bool {
    let editEnd = NSMaxRange(edit.range)
    switch (kind, edit.kind) {
    case (.typing, .typing):
      // 쓰던 낱말 안이나 끝에서 이어 쓴다. (한글 조합은 앞 글자를 바꿔 치운다) 띄어 쓴 뒤 새 낱말은 새 단계다.
      return edit.range.location <= end && editEnd >= start && editEnd <= end
        && !(edit.startsWord && hasWordCharacters)
    case (.typing, .deleting):
      // 방금 친 글자를 지우는 것은 고쳐 쓰는 중이다.
      return edit.range.location >= start && editEnd <= end
    case (.deleting, .deleting):
      // 앞으로(백스페이스) 또는 뒤로 이어 지운다.
      return editEnd == start || edit.range.location == start
    default:
      return false
    }
  }

  mutating func apply(_ edit: TextEdit) {
    if kind == .typing {
      start = min(start, edit.range.location)
      end += edit.insertedLength - edit.range.length
      hasWordCharacters = hasWordCharacters || edit.insertsWordCharacters
    } else {
      start = edit.range.location
      end = start
    }
  }
}

final class MemoEditorView: ExpoView, UITextViewDelegate, NSTextStorageDelegate {
  let onChangeContent = EventDispatcher()
  let onChangeFormat = EventDispatcher()
  let onChangeHistory = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onLeaveParagraph = EventDispatcher()

  private static let historyLimit = 500

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
  /// 낱말 하나, 이어 지운 글자들, 줄 바꿈, 명령 하나가 각각 한 단계다.
  private var history: [String] = []
  private var historyIndex = 0
  /// 마지막 단계가 아직 이어 쓰는 중이면 그 범위
  private var openStep: OpenStep?
  /// shouldChangeTextIn에서 받은 편집. textViewDidChange에서 기록한다.
  private var pendingEdit: TextEdit?
  /// 마지막으로 기록한 글. 편집을 받지 못했으면 이것과 비교해 바뀐 글자를 구한다.
  private var lastText: NSString = ""
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
    lastText = string.copy() as! NSString
    history = [content]
    historyIndex = 0
    openStep = nil
    pendingEdit = nil
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
    // 되돌린 뒤(다시 하기가 남아 있으면) 자동으로 바꾸지 않는다. 바꾸면 다시 하기 기록이 사라진다.
    guard !canRedo else { return changes.map { _ in false } }
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
    openStep = nil
    pendingEdit = nil
    // 되돌아온 문단을 고친 문단으로 치면 커서가 떠날 때 할 일로 다시 바뀐다.
    activeParagraph = nil
    pendingStamp = nil
    pendingContinuation = nil

    textView.inputDelegate?.textWillChange(textView)
    storage.setAttributedString(parsed.text)
    textView.inputDelegate?.textDidChange(textView)
    trailingBlock = parsed.trailingBlock
    editedRange = nil
    lastText = string.copy() as! NSString

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
    pendingEdit = TextEdit(in: string, replacing: range, with: text)

    if text == "\n" && range.length == 0 {
      let paragraph = string.memoParagraph(at: range.location)
      let block = blockOf(paragraph)
      if block.isList && string.memoContentRange(of: paragraph).length == 0 {
        // 빈 목록 줄에서 엔터를 누르면 줄을 늘리지 않고 목록만 끝낸다.
        pendingEdit = nil
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
        pendingEdit = nil
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
    let edit = committedEdit()
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
    emitContentIfChanged(edit)
    emitFormat()
    trackActiveParagraph(edited: true)
  }

  /// 방금 바뀐 글자. shouldChangeTextIn에서 받은 편집이 결과와 맞지 않거나 없으면 편집 전후 글을 비교해 구한다.
  private func committedEdit() -> TextEdit? {
    let before = lastText
    let after = string
    lastText = after.copy() as! NSString
    defer { pendingEdit = nil }
    if let edit = pendingEdit, before.length - edit.range.length + edit.insertedLength == after.length {
      return edit
    }
    let changed = changedRange(from: before, to: after)
    let removedLength = before.length - (after.length - changed.length)
    guard changed.length > 0 || removedLength > 0 else { return nil }
    let range = NSRange(location: changed.location, length: removedLength)
    return TextEdit(in: before, replacing: range, with: after.substring(with: changed))
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

  /// edit이 없으면(서식, 목록, 체크, 자동 변환) 명령으로 기록한다.
  private func emitContentIfChanged(_ edit: TextEdit? = nil) {
    let content = MemoDocument.serialize(storage, trailingBlock: trailingBlock)
    guard content != lastContent else { return }
    lastContent = content
    record(content, edit: edit)
    onChangeContent(["content": content, "fromHistory": false])
  }

  /// 바뀐 문서를 되돌리기 기록에 남긴다. 쓰던 자리에 바로 이어지는 편집은 지금 단계에 합치고,
  /// 아니면 새 단계를 만든다. 되돌린 뒤 새로 고치면 다시 하기 기록은 버린다.
  private func record(_ content: String, edit: TextEdit?) {
    guard !history.isEmpty else {
      history = [content]
      historyIndex = 0
      return
    }
    history.removeSubrange((historyIndex + 1)...)
    if let edit, var step = openStep, step.continues(with: edit) {
      step.apply(edit)
      history[historyIndex] = content
      openStep = step
      if historyIndex > 0 && history[historyIndex - 1] == content {
        // 이 단계에서 친 글자를 모두 지웠으면 아무것도 바꾸지 않는 단계를 남기지 않는다.
        history.removeLast()
        historyIndex -= 1
        openStep = nil
      }
    } else {
      history.append(content)
      if history.count > Self.historyLimit {
        history.removeFirst(history.count - Self.historyLimit)
      }
      historyIndex = history.count - 1
      openStep = edit.flatMap { OpenStep(beginning: $0) }
    }
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
