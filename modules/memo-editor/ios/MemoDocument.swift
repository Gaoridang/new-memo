import UIKit

/// 문단 종류. 체크된 체크박스는 별도 값으로 둔다.
enum MemoBlock: String {
  case paragraph
  case checkbox
  case checked
  case bullet
  case number

  var isList: Bool { self != .paragraph }
  var isCheckbox: Bool { self == .checkbox || self == .checked }

  /// 툴바와 JS에 알려 주는 종류. 체크된 항목도 체크박스로 본다.
  var kind: MemoBlock { self == .checked ? .checkbox : self }

  /// 엔터로 새 줄을 만들 때 이어지는 종류
  var continuation: MemoBlock { self == .checked ? .checkbox : self }

  private static let markerPrefix = "memo."

  // 문단 종류는 NSParagraphStyle.textLists에 싣는다. 한글 키보드는 직전 글자를 바꿔 치우며
  // 조합하는데, 이때 커스텀 속성 키는 사라지고 표준 속성만 남기 때문이다.
  var textList: NSTextList? {
    guard isList else { return nil }
    return NSTextList(markerFormat: NSTextList.MarkerFormat(rawValue: Self.markerPrefix + rawValue), options: 0)
  }

  init(textList: NSTextList?) {
    guard
      let format = textList?.markerFormat.rawValue,
      format.hasPrefix(Self.markerPrefix),
      let block = MemoBlock(rawValue: String(format.dropFirst(Self.markerPrefix.count)))
    else {
      self = .paragraph
      return
    }
    self = block
  }

  init(paragraphStyle: Any?) {
    self.init(textList: (paragraphStyle as? NSParagraphStyle)?.textLists.first)
  }
}

struct InlineFlags: Equatable {
  var bold = false
  var underline = false
  var strikethrough = false

  init(bold: Bool = false, underline: Bool = false, strikethrough: Bool = false) {
    self.bold = bold
    self.underline = underline
    self.strikethrough = strikethrough
  }

  init(_ attributes: [NSAttributedString.Key: Any]) {
    let font = attributes[.font] as? UIFont
    bold = font?.fontDescriptor.symbolicTraits.contains(.traitBold) ?? false
    underline = (attributes[.underlineStyle] as? Int ?? 0) != 0
    strikethrough = (attributes[.strikethroughStyle] as? Int ?? 0) != 0
  }
}

struct MemoTheme {
  var fontSize: CGFloat = 18
  var textColor = UIColor(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255, alpha: 1)
  var mutedColor = UIColor(red: 0xA1 / 255, green: 0xA1 / 255, blue: 0xA6 / 255, alpha: 1)
  var accentColor = UIColor(red: 0, green: 0x7A / 255, blue: 1, alpha: 1)
  var placeholderColor = UIColor(red: 0xB4 / 255, green: 0xB4 / 255, blue: 0xBA / 255, alpha: 1)

  var lineHeight: CGFloat { ceil(fontSize * 1.22) }
  var lineSpacing: CGFloat { round(fontSize * 0.28) }
  var listIndent: CGFloat { round(fontSize * 1.55) }
  var markerSize: CGFloat { round(fontSize) }

  func font(bold: Bool) -> UIFont {
    .systemFont(ofSize: fontSize, weight: bold ? .bold : .regular)
  }

  func color(for block: MemoBlock) -> UIColor {
    block == .checked ? mutedColor : textColor
  }

  func paragraphStyle(for block: MemoBlock) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.minimumLineHeight = lineHeight
    style.maximumLineHeight = lineHeight
    style.lineSpacing = lineSpacing
    if let list = block.textList {
      style.firstLineHeadIndent = listIndent
      style.headIndent = listIndent
      style.textLists = [list]
    }
    return style
  }

  func isCanonical(_ style: NSParagraphStyle?, for block: MemoBlock) -> Bool {
    guard let style else { return false }
    let indent: CGFloat = block.isList ? listIndent : 0
    return MemoBlock(textList: style.textLists.first) == block
      && style.firstLineHeadIndent == indent
      && style.headIndent == indent
      && style.minimumLineHeight == lineHeight
      && style.lineSpacing == lineSpacing
  }

  func attributes(block: MemoBlock, inline: InlineFlags) -> [NSAttributedString.Key: Any] {
    var attributes: [NSAttributedString.Key: Any] = [
      .font: font(bold: inline.bold),
      .foregroundColor: color(for: block),
      .paragraphStyle: paragraphStyle(for: block),
    ]
    if inline.underline {
      attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
    }
    if inline.strikethrough {
      attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
    }
    return attributes
  }
}

extension NSString {
  /// 줄바꿈까지 포함한 문단 범위들. 문서가 비었거나 줄바꿈으로 끝나면 길이 0인 마지막 빈 문단이 붙는다.
  func memoParagraphs() -> [NSRange] {
    var paragraphs: [NSRange] = []
    var location = 0
    while location < length {
      let range = paragraphRange(for: NSRange(location: location, length: 0))
      paragraphs.append(range)
      location = NSMaxRange(range)
    }
    if endsWithEmptyParagraph {
      paragraphs.append(NSRange(location: length, length: 0))
    }
    return paragraphs
  }

  var endsWithEmptyParagraph: Bool {
    length == 0 || character(at: length - 1) == 0x0A
  }

  /// location이 속한 문단. 마지막 빈 문단이면 길이 0 범위를 돌려준다.
  func memoParagraph(at location: Int) -> NSRange {
    if location >= length {
      if endsWithEmptyParagraph {
        return NSRange(location: length, length: 0)
      }
      return paragraphRange(for: NSRange(location: length - 1, length: 0))
    }
    return paragraphRange(for: NSRange(location: location, length: 0))
  }

  /// 문단에서 끝 줄바꿈을 뺀 내용 범위
  func memoContentRange(of paragraph: NSRange) -> NSRange {
    var end = NSMaxRange(paragraph)
    if end > paragraph.location && character(at: end - 1) == 0x0A {
      end -= 1
    }
    return NSRange(location: paragraph.location, length: end - paragraph.location)
  }
}

/// 저장 형식: { version, blocks: [{ type, checked?, runs: [{ text, bold?, underline?, strikethrough? }] }] }
enum MemoDocument {
  private struct Content: Codable {
    var version: Int
    var blocks: [Block]
  }

  private struct Block: Codable {
    var type: String
    var checked: Bool?
    var runs: [Run]
  }

  private struct Run: Codable {
    var text: String
    var bold: Bool?
    var underline: Bool?
    var strikethrough: Bool?
  }

  static func block(in text: NSAttributedString, at location: Int) -> MemoBlock {
    guard location < text.length else { return .paragraph }
    return MemoBlock(paragraphStyle: text.attribute(.paragraphStyle, at: location, effectiveRange: nil))
  }

  static func serialize(_ text: NSAttributedString, trailingBlock: MemoBlock) -> String {
    let string = text.string as NSString
    var blocks: [Block] = []

    for paragraph in string.memoParagraphs() {
      let type = paragraph.length == 0 ? trailingBlock : block(in: text, at: paragraph.location)
      var runs: [Run] = []
      let content = string.memoContentRange(of: paragraph)
      if content.length > 0 {
        text.enumerateAttributes(in: content) { attributes, range, _ in
          let flags = InlineFlags(attributes)
          let piece = string.substring(with: range)
          if var last = runs.last,
             (last.bold ?? false) == flags.bold,
             (last.underline ?? false) == flags.underline,
             (last.strikethrough ?? false) == flags.strikethrough {
            last.text += piece
            runs[runs.count - 1] = last
          } else {
            runs.append(Run(
              text: piece,
              bold: flags.bold ? true : nil,
              underline: flags.underline ? true : nil,
              strikethrough: flags.strikethrough ? true : nil))
          }
        }
      }
      blocks.append(Block(
        type: type.kind.rawValue,
        checked: type.isCheckbox ? (type == .checked) : nil,
        runs: runs))
    }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(Content(version: 1, blocks: blocks)) else { return "" }
    return String(data: data, encoding: .utf8) ?? ""
  }

  static func deserialize(_ json: String, theme: MemoTheme) -> (text: NSAttributedString, trailingBlock: MemoBlock)? {
    guard
      let data = json.data(using: .utf8),
      let content = try? JSONDecoder().decode(Content.self, from: data),
      !content.blocks.isEmpty
    else { return nil }

    let result = NSMutableAttributedString()
    var trailingBlock = MemoBlock.paragraph

    for (index, item) in content.blocks.enumerated() {
      var type = MemoBlock(rawValue: item.type) ?? .paragraph
      if type == .checkbox && item.checked == true {
        type = .checked
      }
      let isLast = index == content.blocks.count - 1

      for run in item.runs where !run.text.isEmpty {
        // 저장 데이터에 줄바꿈이 섞여 있어도 문단 구조가 깨지지 않도록 공백으로 바꾼다.
        let text = run.text.replacingOccurrences(of: "\n", with: " ")
        let flags = InlineFlags(bold: run.bold ?? false, underline: run.underline ?? false, strikethrough: run.strikethrough ?? false)
        result.append(NSAttributedString(string: text, attributes: theme.attributes(block: type, inline: flags)))
      }

      if !isLast {
        result.append(NSAttributedString(string: "\n", attributes: theme.attributes(block: type, inline: InlineFlags())))
      } else if item.runs.allSatisfy({ $0.text.isEmpty }) {
        trailingBlock = type
      }
    }

    return (result, trailingBlock)
  }
}
