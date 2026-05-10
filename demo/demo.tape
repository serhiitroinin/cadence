# cadence demo — regenerate with: cd demo && vhs demo.tape
# The demo wrapper (./cadence) dispatches to fixtures/ so this works without auth.

Output demo.gif

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font Mono"
Set FontSize 22
Set Width 1180
Set Height 600
Set Padding 28
Set TypingSpeed 50ms
Set PlaybackSpeed 1.0

# Everforest Dark theme (matches Ghostty config)
Set Theme '{"name":"Everforest Dark","black":"#475258","red":"#e67e80","green":"#a7c080","yellow":"#dbbc7f","blue":"#7fbbb3","magenta":"#d699b6","cyan":"#83c092","white":"#d3c6aa","brightBlack":"#56635f","brightRed":"#e67e80","brightGreen":"#a7c080","brightYellow":"#dbbc7f","brightBlue":"#7fbbb3","brightMagenta":"#d699b6","brightCyan":"#83c092","brightWhite":"#d3c6aa","background":"#2d353b","foreground":"#d3c6aa","cursor":"#d3c6aa","selection":"#475258"}'

Hide
Type "export PATH=$PWD:$PATH; clear" Enter
Sleep 200ms
Show

Type "cadence tr" Sleep 400ms Enter
Sleep 4s

Type "clear" Enter
Sleep 200ms

Type "cadence ts" Sleep 400ms Enter
Sleep 4s

Type "clear" Enter
Sleep 200ms

Type "cadence bb" Sleep 400ms Enter
Sleep 4s

Type "clear" Enter
Sleep 200ms

Type "cadence sleep" Sleep 400ms Enter
Sleep 4s
