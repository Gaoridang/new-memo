import ExpoModulesCore
import UIKit

final class MemoEditorView: ExpoView, UITextViewDelegate, NSTextStorageDelegate {
  let onChangeContent = EventDispatcher()
  let onChangeFormat = EventDispatcher()
  let onFocusChange = EventDispatcher()

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
    textView.undoManager?.removeAllActions()
    lastContent = MemoDocument.serialize(storage, trailingBlock: trailingBlock)
    syncTypingAttributes()
    refreshDecorations()
    emitFormat()
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
    emitContentIfChanged()
    emitFormat()
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    syncTypingAttributes()
    emitFormat()
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onFocusChange(["focused": true])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
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

  private func emitContentIfChanged() {
    let content = MemoDocument.serialize(storage, trailingBlock: trailingBlock)
    guard content != lastContent else { return }
    lastContent = content
    onChangeContent(["content": content])
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
