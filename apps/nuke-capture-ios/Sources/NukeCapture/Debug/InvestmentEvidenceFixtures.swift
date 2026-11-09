#if DEBUG
// Synthetic legacy-reader payload. The first session's600 could be300labor+200parts+100tools;
// its transport contains only the combined cost, with no breakdown or currency.
enum InvestmentEvidenceFixtures {
    static let mastheadSection = """
    {"kind":"masthead","identity_source":{"year":1973,"make":"Fixture","model":"Coupe"},
     "price":{"value":10000,"unit":"USD","source":{"kind":"listing","label":"Fixture sale source","url":"https://example.com/fixture-sale"},"trust":0.8},"priceLabel":"Sold"},
    """
    static let valuation = """
    {"value":12000,"value_low":11000,"value_high":13000,"comp_method":"class_stratified","input_count":3,
     "signals":[{"name":"comps","fired":true},{"name":"condition","fired":true}]}
    """
    static let saleEvents = """
    [{"id":"00000000-0000-4000-8000-00000000c101","event_type":"auction_sold","event_date":"2026-02-03",
      "metadata":{"sale_price":10000,"platform":"bat","source_url":"https://example.com/fixture-sale"}}]
    """
    // A positive legacy curve would falsely call the first receipt "bought".
    static let timeline = """
    {"points":[{"date":"2026-03-09","kind":"receipt","delta":35,"cumulative":35},
      {"date":"2026-03-10","kind":"receipt","delta":40,"cumulative":75}],
     "final_cumulative_dated":75,"total_with_undated":85,"undated":{"n":1,"total":10}}
    """
    static let proof = """
    {"is_owner_view":true,
     "proven":{"parts":{"value":321035,"count":1},"confirmed_labor":{"value":600,"source":"work_sessions:owner_confirmed","confidence":"high"},
       "money_in":{"value":90,"count":2},"money_out":{"value":150}},
     "attributed":{"cost":{"value":250},"income":{"value":0}},
     "projected":{"labor":{"value":777777}},"market":{"value":666666,"confidence":"model"},
     "totals":{"invested_proven":987654,"invested_with_attributed":987904,"invested_with_projected":999999,"roi_proven_pct":88},
     "by_party":[{"party":"Aggregate party must not be rendered","direction":"out","count":2,"total":654321,"trust":"proven"}],
     "audit":{"receipts":[{"id":"\(ReceiptDepthFixtures.receiptId)","vendor":"Fixture Parts Shop","amount":35,"date":"2026-03-09","source":"receipts"}],
       "payments":[
         {"id":"00000000-0000-4000-8000-00000000a101","counterparty":"Reported sender","direction":"in","amount":90,"method":"zelle","date":"2026-03-10","source":"payment_events"},
         {"id":"00000000-0000-4000-8000-00000000a102","counterparty":"Attributed giver","direction":"out","amount":250,"method":"owner_attestation","date":"2026-03-10","source":"payment_events"},
         {"id":"00000000-0000-4000-8000-00000000a103","counterparty":"Zero report","direction":"out","amount":0,"method":"cash","date":"2026-03-10","source":"payment_events"}],
       "work_sessions":[
         {"id":"00000000-0000-4000-8000-00000000f001","date":"2026-03-11","cost":600,"confirmed":true,"source":"work_sessions"},
         {"id":"00000000-0000-4000-8000-00000000f002","date":"2026-03-12","cost":400,"confirmed":false,"source":"work_sessions"},
         {"id":"00000000-0000-4000-8000-00000000f003","date":"2026-03-13","source":"work_sessions"}]}}
    """
    static let withheld = """
    {"is_owner_view":false,"proven":{"parts":{"value":987654,"count":42},"confirmed_labor":{"value":600},"money_in":{},"money_out":{}},
     "projected":{"labor":{}},"market":{"value":666666},"totals":{"invested_proven":987654,"roi_proven_pct":88},"audit":{}}
    """
}
#endif
