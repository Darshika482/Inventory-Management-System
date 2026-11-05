#!/bin/bash
cd /home/user/reelmimic/projects/stockshop/capture
for job in stock stockpages sale salepages staff offline; do
  pkill -f mockserver.mjs; sleep 0.5
  (node mockserver.mjs > mock.log 2>&1 &); sleep 1
  DSF=4 OUT=../screens timeout 400 node capture.mjs $job >> final.log 2>&1
  echo "done $job" >> final.log
done
echo ALLDONE >> final.log
