import UIKit

extension NSAttributedString.Key {
  /// 두들이 붙은 낱말. 값은 MemoDoodleMark이고 낱말 전체에 건다. 낱말은 두들과 함께 칩으로 그린다.
  static let memoDoodle = NSAttributedString.Key("memo.doodle")
}

/// 낱말 하나에 붙은 두들. 표시 객체 하나는 낱말 하나에만 쓴다. (낱말이 띄어쓰기로 나뉘면 앞 낱말에 남는다)
/// 끌어서 옮기기처럼 UIKit이 글자를 속성째 보관(archive)하는 경우가 있어 NSSecureCoding을 따른다.
final class MemoDoodleMark: NSObject, NSSecureCoding {
  static var supportsSecureCoding: Bool { true }

  let id: String

  init(id: String) {
    self.id = id
  }

  init?(coder: NSCoder) {
    guard let id = coder.decodeObject(of: NSString.self, forKey: "id") else { return nil }
    self.id = id as String
  }

  func encode(with coder: NSCoder) {
    coder.encode(id, forKey: "id")
  }
}

/// 그릴 준비를 마친 두들 그림 한 겹. 좌표는 24x24 격자다.
struct DoodleLayer {
  let path: CGPath
  let fill: UIColor?
  let stroke: UIColor?
  let width: CGFloat
  let opacity: CGFloat
  let offset: CGPoint
}

/// 두들 그림 하나와, 그 낱말을 감싸는 칩의 색
struct DoodleArt {
  let layers: [DoodleLayer]
  let chipFill: UIColor
}

/// 두들 칩의 치수. 칩은 낱말과 그 뒤의 두들을 감싼다.
struct DoodleMetrics {
  /// 쌓인 줄의 칩끼리 닿지 않도록 줄 간격 안에 들어가는 높이
  let chipHeight: CGFloat
  let doodleSize: CGFloat
  /// 칩 왼쪽 여백. 낱말 앞 띄어쓰기를 이만큼 넓힌다.
  let padLeft: CGFloat
  /// 낱말과 두들 사이
  let innerGap: CGFloat
  let padRight: CGFloat

  /// 낱말 끝 글자 뒤에 비워 두는 자리
  var gap: CGFloat { innerGap + doodleSize + padRight }
}

/// 떼는 중인 두들. 문서의 표시는 이미 없고, 사라지는 동안 칩 자리와 그림만 남는다.
struct DoodleGhost {
  let word: NSRange
  let id: String
}

enum MemoDoodles {
  private static let gridSize: CGFloat = 24
  /// 끝낸 할 일의 두들은 글씨처럼 흐리게 그린다.
  private static let checkedAlpha: CGFloat = 0.45

  // MARK: - Art

  static func parseArt(_ records: [DoodleArtRecord]) -> [String: DoodleArt] {
    var art: [String: DoodleArt] = [:]
    for record in records {
      let layers = record.ops.map { op in
        DoodleLayer(
          path: parsePath(op.d),
          fill: color(op.fill),
          stroke: color(op.stroke),
          width: CGFloat(op.width ?? 1.5),
          opacity: CGFloat(op.opacity ?? 1),
          offset: CGPoint(x: op.dx ?? 0, y: op.dy ?? 0))
      }
      art[record.id] = DoodleArt(layers: layers, chipFill: color(record.chipFill) ?? .systemGray6)
    }
    return art
  }

  /// '#RRGGBB'
  private static func color(_ hex: String?) -> UIColor? {
    guard let hex, hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1)
  }

  /// 절대 좌표의 M·L·C·Q·Z만 읽는다. (src/doodles/art.ts가 그렇게만 만든다)
  static func parsePath(_ d: String) -> CGPath {
    enum Token {
      case command(Character)
      case number(CGFloat)
    }
    var tokens: [Token] = []
    var number = ""
    func flush() {
      if let value = Double(number) { tokens.append(.number(CGFloat(value))) }
      number = ""
    }
    for character in d {
      switch character {
      case "M", "L", "C", "Q", "Z":
        flush()
        tokens.append(.command(character))
      case "-":
        flush()
        number.append(character)
      case "0"..."9", ".":
        number.append(character)
      default:
        flush()
      }
    }
    flush()

    let path = CGMutablePath()
    var command: Character = "M"
    var values: [CGFloat] = []
    func point(_ index: Int) -> CGPoint { CGPoint(x: values[index], y: values[index + 1]) }
    func apply() {
      switch command {
      case "M" where values.count == 2:
        path.move(to: point(0))
        command = "L" // M 뒤에 이어지는 점은 L로 읽는다.
      case "L" where values.count == 2:
        path.addLine(to: point(0))
      case "Q" where values.count == 4:
        path.addQuadCurve(to: point(2), control: point(0))
      case "C" where values.count == 6:
        path.addCurve(to: point(4), control1: point(0), control2: point(2))
      default:
        return
      }
      values.removeAll()
    }
    for token in tokens {
      switch token {
      case .command("Z"):
        path.closeSubpath()
        values.removeAll()
      case .command(let next):
        command = next
        values.removeAll()
      case .number(let value):
        values.append(value)
        apply()
      }
    }
    return path
  }

  // MARK: - Layout

  private static func isSpace(_ unit: unichar) -> Bool {
    guard let scalar = Unicode.Scalar(unit) else { return false }
    return CharacterSet.whitespacesAndNewlines.contains(scalar)
  }

  /// range에서 처음 나오는 공백 아닌 글자가 속한 낱말(띄어쓰기 사이)
  private static func word(in string: NSString, touching range: NSRange) -> NSRange? {
    var location = range.location
    while location < NSMaxRange(range) && isSpace(string.character(at: location)) {
      location += 1
    }
    guard location < NSMaxRange(range) else { return nil }
    var start = location
    while start > 0 && !isSpace(string.character(at: start - 1)) {
      start -= 1
    }
    var end = location
    while end < string.length && !isSpace(string.character(at: end)) {
      end += 1
    }
    return NSRange(location: start, length: end - start)
  }

  /// 두들이 붙은 낱말들 (문서 순서). 표시가 낱말 일부에만 걸려 있어도 낱말 전체를 돌려준다.
  static func words(in storage: NSTextStorage) -> [(range: NSRange, mark: MemoDoodleMark)] {
    let string = storage.string as NSString
    var result: [(range: NSRange, mark: MemoDoodleMark)] = []
    var usedMarks = Set<ObjectIdentifier>()
    var usedWords = Set<Int>()
    storage.enumerateAttribute(.memoDoodle, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
      guard let mark = value as? MemoDoodleMark,
            let word = word(in: string, touching: range),
            !usedWords.contains(word.location),
            usedMarks.insert(ObjectIdentifier(mark)).inserted else { return }
      usedWords.insert(word.location)
      result.append((word, mark))
    }
    return result
  }

  static func hasMark(in storage: NSTextStorage, range: NSRange) -> Bool {
    var found = false
    storage.enumerateAttribute(.memoDoodle, in: range) { value, _, stop in
      if value != nil {
        found = true
        stop.pointee = true
      }
    }
    return found
  }

  /// 낱말 끝 글자(한 글자로 보이는 묶음)
  private static func lastCharacter(of word: NSRange, in string: NSString) -> NSRange {
    string.rangeOfComposedCharacterSequence(at: NSMaxRange(word) - 1)
  }

  /// 두들 표시를 낱말 전체로 맞춘다. (고쳐 쓰거나 이어 쓴 글자까지, 띄어쓰기로 나뉜 낱말은 앞 낱말만) 표시가 없으면 아무것도 하지 않는다.
  static func normalizeMarks(_ storage: NSTextStorage) {
    let full = NSRange(location: 0, length: storage.length)
    var marked: [(range: NSRange, mark: MemoDoodleMark)] = []
    storage.enumerateAttribute(.memoDoodle, in: full) { value, range, _ in
      if let mark = value as? MemoDoodleMark { marked.append((range, mark)) }
    }
    if marked.isEmpty { return }
    let words = words(in: storage)
    let settled = marked.count == words.count
      && zip(marked, words).allSatisfy { $0.range == $1.range && $0.mark === $1.mark }
    if settled { return }
    storage.beginEditing()
    storage.removeAttribute(.memoDoodle, range: full)
    for word in words {
      storage.addAttribute(.memoDoodle, value: word.mark, range: word.range)
    }
    storage.endEditing()
  }

  /**
   낱말마다 앞 띄어쓰기와 끝 글자 뒤에 칩 자리(kern)를 둔다. progress는 칩이 나타난 정도(0-1)이고,
   ghosts는 사라지는 중인 두들이다. metrics가 없으면 자리를 모두 뺀다.
   글자 간격만 바꾸고 문서(표시)는 건드리지 않으므로, 움직이는 동안 프레임마다 불러도 된다.
   */
  static func applyKern(
    _ storage: NSTextStorage,
    metrics: DoodleMetrics?,
    progress: (MemoDoodleMark) -> CGFloat,
    ghosts: [(ghost: DoodleGhost, progress: CGFloat)]
  ) {
    let full = NSRange(location: 0, length: storage.length)
    var existing: [(range: NSRange, value: CGFloat)] = []
    storage.enumerateAttribute(.kern, in: full) { value, range, _ in
      if let value = value as? NSNumber { existing.append((range, CGFloat(value.doubleValue))) }
    }
    let words = words(in: storage)
    if words.isEmpty && ghosts.isEmpty && existing.isEmpty { return }

    let string = storage.string as NSString
    // 글자 위치마다 한 번만 (사라지는 두들과 새 두들이 같은 낱말이면 넓은 쪽)
    var byLocation: [Int: (range: NSRange, value: CGFloat)] = [:]
    func reserve(_ range: NSRange, _ value: CGFloat) {
      if let existing = byLocation[range.location], existing.value >= value { return }
      byLocation[range.location] = (range, value)
    }
    func reserve(word: NSRange, _ t: CGFloat) {
      guard let metrics, word.length > 0, NSMaxRange(word) <= string.length else { return }
      let open = opening(t)
      guard open > 0.001 else { return }
      if word.location > 0 {
        let lead = word.location - 1
        let unit = string.character(at: lead)
        if isSpace(unit) && unit != 0x0A {
          reserve(NSRange(location: lead, length: 1), metrics.padLeft * open)
        }
      }
      reserve(lastCharacter(of: word, in: string), metrics.gap * open)
    }
    for word in words { reserve(word: word.range, progress(word.mark)) }
    for (ghost, t) in ghosts { reserve(word: ghost.word, t) }
    let wanted = byLocation.values.sorted { $0.range.location < $1.range.location }

    let settled = existing.count == wanted.count
      && zip(existing, wanted).allSatisfy { $0.range == $1.range && abs($0.value - $1.value) < 0.01 }
    if settled { return }
    storage.beginEditing()
    storage.removeAttribute(.kern, range: full)
    for kern in wanted {
      storage.addAttribute(.kern, value: kern.value, range: kern.range)
    }
    storage.endEditing()
  }

  // MARK: - Drawing

  /// 낱말과 두들을 칩으로 그린다. (글자 뒤에 그리므로 낱말 글자는 칩 위에 보인다) dimmed는 글자 위치가 끝낸 할 일에 속하는지다.
  /// include가 false인 낱말은 그리지 않는다. (다른 곳에서 그리는 문단)
  static func draw(
    storage: NSTextStorage,
    layoutManager: NSLayoutManager,
    textContainer: NSTextContainer,
    inset: UIEdgeInsets,
    lineHeight: CGFloat,
    metrics: DoodleMetrics,
    art: [String: DoodleArt],
    dirtyRect: CGRect,
    progress: (MemoDoodleMark) -> CGFloat,
    ghosts: [(ghost: DoodleGhost, progress: CGFloat)],
    include: (NSRange) -> Bool = { _ in true },
    dimmed: (Int) -> Bool
  ) {
    guard !art.isEmpty, let context = UIGraphicsGetCurrentContext() else { return }
    let string = storage.string as NSString
    layoutManager.ensureLayout(for: textContainer)

    func drawChip(_ word: NSRange, _ id: String, _ t: CGFloat) {
      guard t > 0, let art = art[id], word.length > 0, NSMaxRange(word) <= string.length else { return }
      let last = lastCharacter(of: word, in: string)
      let lastGlyphs = layoutManager.glyphRange(forCharacterRange: last, actualCharacterRange: nil)
      guard lastGlyphs.length > 0 else { return }
      var lineGlyphs = NSRange()
      let line = layoutManager.lineFragmentRect(forGlyphAt: lastGlyphs.location, effectiveRange: &lineGlyphs)
      let lastX = line.minX + layoutManager.location(forGlyphAt: lastGlyphs.location).x
      // 낱말 첫 글자. 낱말이 줄에 걸쳐 나뉘었으면 끝 글자가 있는 줄의 처음부터 감싼다.
      let firstGlyph = max(layoutManager.glyphIndexForCharacter(at: word.location), lineGlyphs.location)
      let startX = line.minX + layoutManager.location(forGlyphAt: firstGlyph).x
      // 끝 글자의 원래 폭 (칩 자리 kern을 뺀 폭)
      var attributes = storage.attributes(at: last.location, effectiveRange: nil)
      attributes[.kern] = nil
      let wordEnd = lastX + NSAttributedString(string: string.substring(with: last), attributes: attributes).size().width

      let open = opening(t)
      let centerY = inset.top + line.minY + lineHeight / 2
      let chip = CGRect(
        x: inset.left + startX - metrics.padLeft * open,
        y: centerY - metrics.chipHeight / 2,
        width: wordEnd - startX + (metrics.padLeft + metrics.gap) * open,
        height: metrics.chipHeight)
      guard chip.intersects(dirtyRect) else { return }
      let alpha = dimmed(last.location) ? checkedAlpha : 1

      context.saveGState()
      context.setAlpha(alpha * min(1, t * 2.5))
      art.chipFill.setFill()
      UIBezierPath(roundedRect: chip, cornerRadius: metrics.chipHeight / 2).fill()
      context.restoreGState()

      let pop = popping(t)
      guard pop > 0 else { return }
      let size = metrics.doodleSize
      let frame = CGRect(
        x: inset.left + wordEnd + metrics.innerGap * open,
        y: centerY - size / 2,
        width: size,
        height: size)
      drawLayers(art.layers, in: frame, scale: easeOutBack(pop), alpha: alpha * min(1, pop * 2), context: context)
    }

    for word in words(in: storage) where include(word.range) { drawChip(word.range, word.mark.id, progress(word.mark)) }
    for (ghost, t) in ghosts where include(ghost.word) { drawChip(ghost.word, ghost.id, t) }
  }

  private static func drawLayers(_ layers: [DoodleLayer], in frame: CGRect, scale: CGFloat, alpha: CGFloat, context: CGContext) {
    context.saveGState()
    // 겹친 선과 면이 따로 비치지 않도록 한 장으로 합쳐 흐리게 한다.
    context.setAlpha(alpha)
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    context.translateBy(x: frame.midX, y: frame.midY)
    context.scaleBy(x: scale * frame.width / gridSize, y: scale * frame.height / gridSize)
    context.translateBy(x: -gridSize / 2, y: -gridSize / 2)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    for layer in layers {
      context.saveGState()
      context.setAlpha(layer.opacity)
      context.translateBy(x: layer.offset.x, y: layer.offset.y)
      if let fill = layer.fill {
        context.addPath(layer.path)
        context.setFillColor(fill.cgColor)
        context.fillPath()
      }
      if let stroke = layer.stroke {
        context.addPath(layer.path)
        context.setStrokeColor(stroke.cgColor)
        context.setLineWidth(layer.width)
        context.strokePath()
      }
      context.restoreGState()
    }
    context.endTransparencyLayer()
    context.restoreGState()
  }

  // MARK: - Easing

  /// 칩이 벌어진 정도. 나타나는 시간의 앞 60% 동안 벌어진다.
  private static func opening(_ t: CGFloat) -> CGFloat {
    easeInOut(t / 0.6)
  }

  /// 두들이 튀어 오른 정도. 칩이 거의 벌어졌을 때부터 나타나 칩 밖으로 넘치지 않는다.
  private static func popping(_ t: CGFloat) -> CGFloat {
    min(1, max(0, (t - 0.35) / 0.65))
  }

  static func easeInOut(_ t: CGFloat) -> CGFloat {
    let t = min(1, max(0, t))
    return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
  }

  /// 끝에서 살짝 넘쳤다가 돌아온다.
  static func easeOutBack(_ t: CGFloat) -> CGFloat {
    let c1: CGFloat = 1.70158
    let c3 = c1 + 1
    return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2)
  }
}

/// 두들 칩이 나타나고 사라지는 움직임. 시간에 따른 진행도(0-1)만 들고 있고, 프레임마다 onFrame을 부른다.
/// 편집기는 onFrame에서 글자 간격(kern)과 그림만 바꾼다. 문서(표시)는 바꾸지 않아 되돌리기 기록이 생기지 않는다.
final class MemoDoodleAnimator {
  private static let enterDuration: CFTimeInterval = 0.42
  private static let exitDuration: CFTimeInterval = 0.28
  /// 여러 개가 나타날 때 하나씩 늦추는 시간. 몇 개든 모두 합쳐 maxStagger를 넘지 않는다.
  private static let stagger: CFTimeInterval = 0.06
  private static let maxStagger: CFTimeInterval = 0.6

  /// done이면 마지막 프레임이다. (모두 끝 상태)
  var onFrame: ((_ done: Bool) -> Void)?
  /// 나타나는 중인 두들. 표시를 붙잡아 두어 같은 ObjectIdentifier가 다른 표시에 다시 쓰이지 않게 한다.
  private var entering: [ObjectIdentifier: (mark: MemoDoodleMark, start: CFTimeInterval)] = [:]
  private var exiting: [(ghost: DoodleGhost, start: CFTimeInterval)] = []
  private var link: CADisplayLink?
  /// 이번 프레임의 시각. 글자 간격과 그림이 같은 진행도를 쓰도록 프레임마다 한 번 정한다.
  private var now: CFTimeInterval = 0

  var isRunning: Bool { link != nil }

  /// 동작 줄이기를 켰으면 움직이지 않고 바로 바꾼다.
  static var isEnabled: Bool { !UIAccessibility.isReduceMotionEnabled }

  /// 새로 붙은 두들을 차례로 나타나게 한다. (문서 순서로 넘긴다)
  func enter(_ marks: [MemoDoodleMark]) {
    guard Self.isEnabled, !marks.isEmpty else { return }
    now = CACurrentMediaTime()
    let step = Self.step(for: marks.count)
    for (index, mark) in marks.enumerated() {
      entering[ObjectIdentifier(mark)] = (mark, now + Double(index) * step)
    }
    start()
  }

  /// 뗀 두들을 차례로 사라지게 한다.
  func exit(_ ghosts: [DoodleGhost]) {
    guard Self.isEnabled, !ghosts.isEmpty else { return }
    now = CACurrentMediaTime()
    let step = Self.step(for: ghosts.count) / 2
    exiting += ghosts.enumerated().map { ($0.element, now + Double($0.offset) * step) }
    start()
  }

  /// 움직이던 것을 끝 상태로 만든다. (나타나던 것은 다 나타나고, 사라지던 것은 바로 사라진다)
  func finish() {
    entering.removeAll()
    exiting.removeAll()
    stop()
  }

  /// 0이면 아직 없고 1이면 다 나타났다.
  func progress(of mark: MemoDoodleMark) -> CGFloat {
    guard let start = entering[ObjectIdentifier(mark)]?.start else { return 1 }
    return CGFloat(min(1, max(0, (now - start) / Self.enterDuration)))
  }

  /// 사라지는 중인 두들과 남은 정도(1에서 0으로)
  var ghosts: [(ghost: DoodleGhost, progress: CGFloat)] {
    exiting.map { ($0.ghost, CGFloat(1 - min(1, max(0, (now - $0.start) / Self.exitDuration)))) }
  }

  private static func step(for count: Int) -> CFTimeInterval {
    count > 1 ? min(stagger, maxStagger / Double(count - 1)) : 0
  }

  private func start() {
    guard link == nil else { return }
    let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  private func stop() {
    link?.invalidate()
    link = nil
  }

  fileprivate func tick() {
    now = CACurrentMediaTime()
    entering = entering.filter { now - $0.value.start < Self.enterDuration }
    exiting = exiting.filter { now - $0.start < Self.exitDuration }
    let done = entering.isEmpty && exiting.isEmpty
    if done { stop() }
    onFrame?(done)
  }

  deinit {
    link?.invalidate()
  }
}

/// CADisplayLink는 대상을 강하게 붙잡으므로 약하게 가리키는 대리인을 둔다.
private final class DisplayLinkProxy: NSObject {
  private weak var animator: MemoDoodleAnimator?

  init(_ animator: MemoDoodleAnimator) {
    self.animator = animator
  }

  @objc func tick() {
    animator?.tick()
  }
}
