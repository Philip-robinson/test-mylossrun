'use client';

import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import AccessGate from 'components/AccessGate';
import HelpProvider from 'components/help/HelpProvider';
import EditorPassProvider from 'components/EditorPassProvider';
import 'app/globals.css';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#3DB86A',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#6c757d',
      contrastText: '#ffffff',
    },
    background: {
      default: '#f8f9fa',
      paper: '#ffffff',
    },
    text: {
      primary: '#1a1a1a',
      secondary: '#6c757d',
    },
  },
  typography: {
    fontFamily: '"Inter", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '4rem',
      fontWeight: 800,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '3rem',
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    h3: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 600,
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.6,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: '8px',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});

export default function RootLayout({ children }) {
  useEffect(() => {
    // Configure pdf.js worker after library is loaded
    if (typeof window !== 'undefined' && window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }, []);

  return (
    <html lang={'en'}>
      <head>
        <link rel={'icon'} href={'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌵</text></svg>'} />
        <link rel={'preconnect'} href={'https://fonts.googleapis.com'} />
        <link rel={'preconnect'} href={'https://fonts.gstatic.com'} crossOrigin={'anonymous'} />
        <link href={'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'} rel={'stylesheet'} />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        <title>{'MyLossRun'}</title>
        <meta name={'description'} content={'MyLossRun'} />
      </head>
      <body>
        <ThemeProvider theme={lightTheme}>
          <CssBaseline />
          <Toaster />
          <HelpProvider>
            <EditorPassProvider>
              <AccessGate>
                {children}
              </AccessGate>
            </EditorPassProvider>
          </HelpProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
