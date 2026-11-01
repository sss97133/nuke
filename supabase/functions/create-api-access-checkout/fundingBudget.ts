/** Account actual provider units separately from contributor cash. This does not
 * reserve future usage or make an estimated charge into a provider settlement. */
export function accountProviderUsage(receipt: any): { estimated_microusd: number; settled_microusd: number | null; variance_microusd: number | null } | null {
  const price=receipt?.pricing;
  const integer=(n:unknown)=>Number.isSafeInteger(n) && Number(n)>=0;
  if (!receipt || typeof receipt.usage_reference!=='string' || !receipt.usage_reference.trim() ||
    typeof receipt.provider!=='string' || !receipt.provider.trim() || typeof receipt.model!=='string' || !receipt.model.trim() ||
    typeof receipt.account_reference!=='string' || !receipt.account_reference.trim() ||
    !price || price.currency!=='USD' || price.unit!=='million_tokens' ||
    typeof price.source_reference!=='string' || !price.source_reference.trim() ||
    receipt.provider!==price.provider || receipt.model!==price.model ||
    !integer(receipt.input_tokens) || !integer(receipt.output_tokens) || receipt.cached_input_tokens!==0 ||
    !integer(price.input_microusd) || !integer(price.output_microusd)) return null;
  const numerator=BigInt(receipt.input_tokens)*BigInt(price.input_microusd)+BigInt(receipt.output_tokens)*BigInt(price.output_microusd);
  const estimated=(numerator+999999n)/1000000n;
  if(estimated>BigInt(Number.MAX_SAFE_INTEGER))return null;
  const settlement=receipt.settlement;
  if(settlement && (settlement.currency!=='USD' || settlement.provider!==receipt.provider ||
    settlement.account_reference!==receipt.account_reference ||
    settlement.usage_reference!==receipt.usage_reference || !integer(settlement.amount_microusd) ||
    typeof settlement.source_reference!=='string' || !settlement.source_reference.trim()))return null;
  const settled=settlement?.amount_microusd ?? null;
  return {estimated_microusd:Number(estimated),settled_microusd:settled,variance_microusd:settled===null?null:settled-Number(estimated)};
}
