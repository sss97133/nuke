"""Claim-level arithmetic for client documents. Everything here is a flag or a derived view of a claim; no posting."""
from decimal import Decimal
from common import dec, money


def invoice_view(doc):
    """doc: {lines:[{amount}], discount, deposit, printed_net, printed_balance}. Cost, deposit and balance stay separate:
    a zero balance after a deposit is not a zero cost."""
    gross = sum((dec(l['amount']) for l in doc.get('lines', [])), Decimal(0))
    discount = dec(doc.get('discount', '0'))
    net = gross - abs(discount)
    deposit = dec(doc.get('deposit', '0'))
    balance = net - deposit
    flags = []
    if doc.get('printed_net') is not None and dec(doc['printed_net']) != net:
        flags.append(f"printed net {money(dec(doc['printed_net']))} != computed {money(net)}")
    if doc.get('printed_balance') is not None and dec(doc['printed_balance']) != balance:
        flags.append(f"printed balance {money(dec(doc['printed_balance']))} != computed {money(balance)}")
    return {'gross': money(gross), 'discount': money(abs(discount)), 'net': money(net), 'deposit_applied': money(deposit),
            'balance': money(balance), 'cost_basis_retained': money(net), 'zero_balance_is_zero_cost': False, 'flags': flags}


def sum_check(components, printed_total, label):
    """Stated components vs the printed total; returns a flag, never a corrected figure."""
    s = sum((dec(c) for c in components), Decimal(0))
    if s == dec(printed_total):
        return None
    return {'label': label, 'components_sum': money(s), 'printed_total': money(dec(printed_total)),
            'difference': money(dec(printed_total) - s), 'resolution': 'unresolved_not_corrected'}


def cost_vs_billed(supplier_cost, customer_billed):
    """Supplier cost and customer charge stay separate ledgers; the markup is derived, never a third expense."""
    c, b = dec(supplier_cost), dec(customer_billed)
    return {'supplier_cost': money(c), 'customer_billed': money(b), 'markup': money(b - c), 'additive': False}
