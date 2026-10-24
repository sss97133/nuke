while read id; do f=html/$id.html; [ -s $f ] && continue
 curl -sL -m 30 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124" "https://www.conceptcarz.com/events/auctionResults/auctionResults.aspx?eventID=$id&reportID=1" -o $f -w "$id %{http_code}\n"; sleep 3; done < ids.txt
echo DONE
