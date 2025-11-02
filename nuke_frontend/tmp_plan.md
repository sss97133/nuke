### Plan: Enable AI image sets reporting

1. Fix vehicle lookup in `profileService`
   - Update `vehicleLookup` query to request existing columns (`year`, `make`, `model`, `title`) and drop `nickname` to stop REST 400 errors.
   - Ensure fallback label logic uses available fields only.

2. Update `profile-image-analyst` edge function
   - Switch OpenAI call to an enabled model (`gpt-4o-mini-2024-07-18`) and keep a fallback list for future changes.
   - Expand prompt context with receipts/timeline info already fetched, and add stricter JSON response_format parsing.
   - Improve error handling so 4xx/5xx returns include message but don’t crash client.

3. Persist insights reliably
   - Ensure upsert into `profile_image_insights` stores `summary_date`, totals, and raw JSON even when partial data.
   - Add migration adjustments if needed (e.g. default numeric columns to 0) to avoid null handling issues on read.

4. Front-end polish
   - In `DailyContributionReport`, show informative fallback (“AI insight pending”) while insight generation is running or failed.
   - Log/alert when AI insight fetch returns error so user sees that analysis is still processing.

