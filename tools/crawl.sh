#!/bin/bash
# For each ballot type: download pamphlet, extract the SAMPLE BALLOT pages' text, delete the PDF.
D="$(cd "$(dirname "$0")" && pwd)"
one() {
  bt=$(printf "%03d" "$1"); out="$D/txt/$bt.txt"; [ -s "$out" ] && return
  pdf="$D/tmp/$bt.pdf"
  curl -s -m 180 -o "$pdf" "https://www.sdvote.com/content/dam/rov/en/sb/SB-ENG-$bt.pdf" || { echo "$bt curl-fail" >> "$D/crawl.log"; return; }
  if ! pdfinfo "$pdf" >/dev/null 2>&1; then echo "$bt bad-pdf" >> "$D/crawl.log"; rm -f "$pdf"; return; fi
  n=$(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')
  pages=""
  for p in $(seq 1 "$n"); do
    if pdftotext -f $p -l $p "$pdf" - 2>/dev/null | grep -q "SAMPLE BALLOT"; then pages="$pages $p"; fi
  done
  : > "$out.part"
  for p in $pages; do echo "=== PAGE $p ===" >> "$out.part"; pdftotext -f $p -l $p "$pdf" - >> "$out.part" 2>/dev/null; done
  mv "$out.part" "$out"; rm -f "$pdf"; echo "$bt ok pages:$pages" >> "$D/crawl.log"
}
export -f one; export D
seq 1 753 | xargs -P 5 -I{} bash -c 'one {}'
echo "DONE $(date)" >> "$D/crawl.log"
