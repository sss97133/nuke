# shadow v11 (leak-free, odometer-at-sale coverage + missing indicators)
Order: load_v11 -> feat_v11 -> feat4_v11 -> dump5 -> fwd_sets11 <cut> (x3) -> sel_v11 (selection, train rows only) -> fwd_eval11 v11 sets_v11.npz fwdsets11_ sel_best.json 0 -> mk_v11.
Odometer extraction: ext_text.py (regex on vehicle text, single-sale vehicles), verify.py (page check, verify50*.json).
Results: eval_v11.json (v11) vs ../v10/eval_v10.json, eval_v9.json.
