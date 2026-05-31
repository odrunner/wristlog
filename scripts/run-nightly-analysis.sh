#!/bin/zsh
# Wrapper for nightly analysis — avoids macOS TCC sandbox issues with direct python in LaunchAgents
cd "/Users/ozgurdogan/Documents/Claude project/watch tracker"
/usr/bin/python3 scripts/nightly-analysis.py
