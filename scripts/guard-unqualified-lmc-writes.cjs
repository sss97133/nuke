/**
 * These legacy writers identify rows by supplier number alone or take the
 * first row with that number. A number can occur in several source pages,
 * catalog editions, vehicle applications and callout positions. Until a
 * source-qualified, variant-aware writer exists, fail before making network
 * requests or changing any existing evidence.
 */
module.exports = function guardUnqualifiedLmcWrites() {
  const error = new Error(
    'LMC source writes are paused: the legacy writer cannot establish the exact source listing and vehicle scope. Use a source-qualified, variant-aware intake before writing catalog or assembly records.'
  );
  error.code = 'LMC_SOURCE_SCOPE_UNQUALIFIED';
  throw error;
};
