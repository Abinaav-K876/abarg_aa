import webview
import sys

# Hide console for GUI app
if getattr(sys, 'frozen', False):
    import pyi_splash

if __name__ == '__main__':
    # Close splash screen if it exists
    if getattr(sys, 'frozen', False) and 'pyi_splash' in sys.modules:
        pyi_splash.close()

    # Create window pointing to the live server
    webview.create_window('ABARG Chat', 'https://abarg.onrender.com', width=1200, height=800, resizable=True)
    
    # Start webview
    webview.start()
