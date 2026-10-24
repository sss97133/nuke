import XCTest
@testable import NukeCapture

final class WebLinkTests: XCTestCase {
    func testNormalizesRecordedSourceStrings() {
        XCTAssertEqual(WebLink.url(" https://bringatrailer.com/listing/x \n")?.absoluteString, "https://bringatrailer.com/listing/x")
        XCTAssertEqual(WebLink.url("bringatrailer.com/listing/x")?.absoluteString, "https://bringatrailer.com/listing/x")
        XCTAssertNotNil(WebLink.url("https://example.com/a b"))
        XCTAssertNil(WebLink.url("http:"))
        XCTAssertNil(WebLink.url("mailto:a@b.com"))
        XCTAssertNil(WebLink.url("12345"))
        XCTAssertNil(WebLink.url(nil))
    }
}
