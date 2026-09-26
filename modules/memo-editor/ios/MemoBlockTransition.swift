import UIKit

/// 전환 애니메이션이 실제 글자 대신 보여 줄 문단 그림. 좌표는 텍스트 뷰 콘텐츠 기준이다.
struct MemoParagraphImage {
  /// 픽셀 경계에 맞춘 그림 영역. 끝 위치에서 실제 글자와 한 픽셀도 어긋나지 않는다.
  let frame: CGRect
  let image: CGImage
  /// 글자가 차지하는 영역. 빛이 이 구간을 지나간다.
  let textBounds: CGRect
  /// 첫 줄 위부터 마지막 줄 아래까지 (줄 간격 제외)
  let linesTop: CGFloat
  let linesBottom: CGFloat
}

/// 전환 애니메이션이 실제 마커 대신 그릴 체크박스. 좌표는 텍스트 뷰 콘텐츠 기준이다.
struct MemoCheckboxImage {
  let frame: CGRect
  let image: CGImage
  /// 나타날 때 잠깐 보이는 강조색 윤곽
  let litImage: CGImage?
}

/// 코드로 일반 문단을 체크박스로 바꿀 때(할 일 자동 변환, 붙여넣은 글 정리) 문단이 바뀌는 모습을 보여 준다.
/// 바뀐 뒤의 문단을 그림으로 떠서 원래 자리에서 새 자리로 밀어 옮기고, 체크박스를 띄우고, 글자 위로 빛을 훑는다.
/// 그동안 실제 글자와 체크박스는 감춰 두었다가 끝나면 그대로 드러낸다.
final class MemoBlockTransition {
  /// 전환 중인 문단 (끝 줄바꿈 포함)
  let range: NSRange
  private let endsWithNewline: Bool
  private let overlay = UIView()
  private var pendingFinish: DispatchWorkItem?
  private var onFinish: ((MemoBlockTransition) -> Void)?

  init(range: NSRange, endsWithNewline: Bool) {
    self.range = range
    self.endsWithNewline = endsWithNewline
  }

  /// location에서 시작하는 편집이 이 문단의 글자나 위치를 바꾸는지. 다음 줄을 쓰는 동안에는 애니메이션을 이어 간다.
  func isAffected(byEditAt location: Int) -> Bool {
    location < NSMaxRange(range) || (location == NSMaxRange(range) && !endsWithNewline)
  }

  func start(
    in textView: MemoTextView,
    paragraph: MemoParagraphImage,
    checkbox: MemoCheckboxImage,
    indent: CGFloat,
    fontSize: CGFloat,
    accentColor: UIColor,
    onFinish: @escaping (MemoBlockTransition) -> Void
  ) {
    self.onFinish = onFinish
    overlay.isUserInteractionEnabled = false
    overlay.frame = paragraph.frame
    // 마커 뷰 바로 위에 둔다. 글자를 그리는 뷰는 이 문단에서 비어 있고, 커서와 선택 표시는 계속 위에 보인다.
    textView.insertSubview(overlay, aboveSubview: textView.markerView)

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let scale = textView.traitCollection.displayScale
    let origin = paragraph.frame.origin
    let text = CALayer()
    text.frame = overlay.bounds
    text.contents = paragraph.image
    text.contentsScale = scale
    let marker = CALayer()
    marker.frame = checkbox.frame.offsetBy(dx: -origin.x, dy: -origin.y)
    marker.contents = checkbox.image
    marker.contentsScale = scale
    let now = overlay.layer.convertTime(CACurrentMediaTime(), from: nil)
    let duration = appear(text: text, marker: marker, paragraph: paragraph, checkbox: checkbox,
                          indent: indent, fontSize: fontSize, accent: accentColor, scale: scale, now: now)
    CATransaction.commit()

    // 애니메이션이 모두 끝난 뒤 실제 글자로 바꾼다. 마지막 모습이 같아 바뀌는 순간은 보이지 않는다.
    let work = DispatchWorkItem { [weak self] in self?.finish() }
    pendingFinish = work
    DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.05, execute: work)
  }

  /// 애니메이션을 멈추고 실제 글자와 마커를 드러낸다. 여러 번 불러도 된다.
  func finish() {
    guard let onFinish else { return }
    self.onFinish = nil
    pendingFinish?.cancel()
    pendingFinish = nil
    overlay.removeFromSuperview()
    onFinish(self)
  }

  // MARK: - Animations

  private func appear(
    text: CALayer,
    marker: CALayer,
    paragraph: MemoParagraphImage,
    checkbox: MemoCheckboxImage,
    indent: CGFloat,
    fontSize: CGFloat,
    accent: UIColor,
    scale: CGFloat,
    now: CFTimeInterval
  ) -> CFTimeInterval {
    let origin = paragraph.frame.origin

    // 빛은 체크박스 쪽에서 들어와 글자 끝을 지나 사라진다.
    let bandWidth = round(fontSize * 6)
    let startX = paragraph.textBounds.minX - origin.x - bandWidth / 2
    let endX = paragraph.textBounds.maxX - origin.x + bandWidth / 2
    let shine = min(Timing.shineMax, max(Timing.shineMin, CFTimeInterval((endX - startX) / Timing.shineSpeed)))

    // 글자 뒤로 옅게 번지는 빛
    let glowWidth = round(bandWidth * 1.4)
    let glowHeight = paragraph.linesBottom - paragraph.linesTop + 6
    let glow = CAGradientLayer()
    glow.bounds = CGRect(x: 0, y: 0, width: glowWidth, height: glowHeight)
    glow.position = CGPoint(x: endX, y: paragraph.linesTop - 3 - origin.y + glowHeight / 2)
    glow.cornerRadius = min(8, glowHeight / 2)
    glow.masksToBounds = true
    glow.startPoint = CGPoint(x: 0, y: 0.5)
    glow.endPoint = CGPoint(x: 1, y: 0.5)
    glow.colors = [accent.withAlphaComponent(0), accent.withAlphaComponent(0.08), accent.withAlphaComponent(0)].map(\.cgColor)
    glow.opacity = 0
    overlay.layer.addSublayer(glow)
    overlay.layer.addSublayer(marker)
    overlay.layer.addSublayer(text)

    // 글자 위를 지나가는 빛. 글자 모양으로 가려 글자만 물든다.
    let host = CALayer()
    host.frame = text.bounds
    let glyphs = CALayer()
    glyphs.frame = host.bounds
    glyphs.contents = paragraph.image
    glyphs.contentsScale = scale
    host.mask = glyphs
    let band = CAGradientLayer()
    band.bounds = CGRect(x: 0, y: 0, width: bandWidth, height: host.bounds.height)
    band.position = CGPoint(x: endX, y: host.bounds.midY)
    band.startPoint = CGPoint(x: 0, y: 0.5)
    band.endPoint = CGPoint(x: 1, y: 0.5)
    band.colors = [
      accent.withAlphaComponent(0),
      accent.withAlphaComponent(0.6),
      accent.mixed(with: .white, amount: 0.45),
      accent.withAlphaComponent(0.6),
      accent.withAlphaComponent(0),
    ].map(\.cgColor)
    band.locations = [0, 0.22, 0.5, 0.78, 1]
    host.addSublayer(band)
    text.addSublayer(host)

    // 글자가 들여쓰기만큼 밀려난다.
    add(text, "transform.translation.x", from: -indent, to: 0, begin: now, duration: Timing.slide, curve: Curve.slide)

    // 체크박스가 통통 튀듯 커지며 나타나고, 잠깐 강조색으로 빛나다 제 색으로 돌아온다.
    let markerBegin = now + Timing.markerDelay
    let pop = CASpringAnimation(keyPath: "transform.scale")
    pop.mass = Spring.mass
    pop.stiffness = Spring.stiffness
    pop.damping = Spring.damping
    pop.fromValue = Timing.markerFromScale
    pop.toValue = 1
    pop.beginTime = markerBegin
    pop.duration = pop.settlingDuration
    pop.fillMode = .backwards
    marker.add(pop, forKey: "pop")
    add(marker, "opacity", from: 0, to: 1, begin: markerBegin, duration: Timing.markerFade, curve: Curve.fadeIn)
    if let litImage = checkbox.litImage {
      let lit = CALayer()
      lit.frame = marker.bounds
      lit.contents = litImage
      lit.contentsScale = scale
      lit.opacity = 0
      marker.addSublayer(lit)
      let cool = CAKeyframeAnimation(keyPath: "opacity")
      cool.values = [1, 1, 0]
      cool.keyTimes = [0, NSNumber(value: Timing.litHold / (Timing.litHold + Timing.litFade)), 1]
      cool.beginTime = markerBegin
      cool.duration = Timing.litHold + Timing.litFade
      cool.fillMode = .backwards
      lit.add(cool, forKey: "cool")
    }

    let shineBegin = now + Timing.shineDelay
    add(band, "position.x", from: startX, to: endX, begin: shineBegin, duration: shine, curve: Curve.shine)
    add(glow, "position.x", from: startX, to: endX, begin: shineBegin, duration: shine, curve: Curve.shine)
    let fade = CAKeyframeAnimation(keyPath: "opacity")
    fade.values = [0, 1, 1, 0]
    fade.keyTimes = [0, 0.15, 0.7, 1]
    fade.beginTime = shineBegin
    fade.duration = shine
    fade.fillMode = .backwards
    glow.add(fade, forKey: "fade")

    return max(
      Timing.slide,
      Timing.markerDelay + max(pop.duration, Timing.litHold + Timing.litFade),
      Timing.shineDelay + shine)
  }

  private func add(
    _ layer: CALayer,
    _ keyPath: String,
    from: CGFloat,
    to: CGFloat,
    begin: CFTimeInterval,
    duration: CFTimeInterval,
    curve: CAMediaTimingFunction
  ) {
    let animation = CABasicAnimation(keyPath: keyPath)
    animation.fromValue = from
    animation.toValue = to
    animation.beginTime = begin
    animation.duration = duration
    animation.timingFunction = curve
    animation.fillMode = .backwards
    layer.add(animation, forKey: keyPath)
  }
}

/// 전환 애니메이션 시간(초)과 크기. Android의 MemoBlockTransition과 같은 값을 쓴다.
private enum Timing {
  static let slide: CFTimeInterval = 0.42
  static let markerDelay: CFTimeInterval = 0.07
  static let markerFade: CFTimeInterval = 0.16
  static let markerFromScale: CGFloat = 0.4
  static let litHold: CFTimeInterval = 0.18
  static let litFade: CFTimeInterval = 0.52
  static let shineDelay: CFTimeInterval = 0.11
  static let shineMin: CFTimeInterval = 0.56
  static let shineMax: CFTimeInterval = 0.95
  /// 빛이 지나가는 빠르기 (pt/초)
  static let shineSpeed: CGFloat = 520
}

private enum Spring {
  static let mass: CGFloat = 1
  static let stiffness: CGFloat = 260
  static let damping: CGFloat = 16
}

private enum Curve {
  static let slide = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
  static let shine = CAMediaTimingFunction(controlPoints: 0.45, 0, 0.55, 1)
  static let fadeIn = CAMediaTimingFunction(controlPoints: 0, 0, 0.58, 1)
}

private extension UIColor {
  /// 다른 색을 amount 비율만큼 섞은 색
  func mixed(with other: UIColor, amount: CGFloat) -> UIColor {
    var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    var (r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    guard getRed(&r1, green: &g1, blue: &b1, alpha: &a1),
          other.getRed(&r2, green: &g2, blue: &b2, alpha: &a2) else { return self }
    return UIColor(
      red: r1 + (r2 - r1) * amount,
      green: g1 + (g2 - g1) * amount,
      blue: b1 + (b2 - b1) * amount,
      alpha: a1 + (a2 - a1) * amount)
  }
}
