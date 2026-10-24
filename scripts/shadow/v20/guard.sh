# run a command, kill it if RSS > 1450 MB; log peak
"$@" & P=$!; peak=0
while kill -0 $P 2>/dev/null; do r=$(ps -o rss= -p $P 2>/dev/null|tr -d ' '); r=${r:-0}; [ $r -gt $peak ] && peak=$r
 if [ $r -gt 1484800 ]; then echo "GUARD KILL rss=${r}KB"; kill $P; fi; sleep 1; done
wait $P; ec=$?; echo "GUARD peak_rss_MB=$((peak/1024)) exit=$ec"
exit $ec
