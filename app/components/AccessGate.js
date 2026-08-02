'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Paper,
  Typography,
  CircularProgress,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { validate } from 'services/validate';

export default function AccessGate({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storedAccessCode = localStorage.getItem('access_code');
    const storedEmail = localStorage.getItem('user_email');

    if (storedAccessCode) {
      validateStoredAccessCode(storedAccessCode, storedEmail);
    } else {
      setIsLoading(false);
    }
  }, []);

  const validateStoredAccessCode = async (code, storedEmail) => {
    try {
      const data = await validate(code);

      if (data.success && data.valid) {
        setIsAuthenticated(true);
        if (storedEmail) {
          setEmail(storedEmail);
        }
      } else {
        localStorage.removeItem('access_code');
        localStorage.removeItem('user_email');
      }
    } catch (err) {
      localStorage.removeItem('access_code');
      localStorage.removeItem('user_email');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const data = await validate(accessCode.trim(), email.trim() || null);

      if (data.success && data.valid) {
        localStorage.setItem('access_code', accessCode.trim());
        if (email.trim()) {
          localStorage.setItem('user_email', email.trim());
        }
        setIsAuthenticated(true);
      } else {
        toast.error('Invalid access code. Please check and try again.');
      }
    } catch (err) {
      toast.error('Failed to validate access code. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          backgroundColor: '#f8f9fa',
        }}
      >
        {/* Header with Logo */}
        <Box
          sx={{
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e0e0e0',
            py: 2,
            px: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
            <Image
              src={'/cactuslogo.png'}
              alt={'Cactus Risk'}
              width={140}
              height={38}
              priority
            />
          </Box>
          <Typography
            variant={'body2'}
            sx={{
              textAlign: 'center',
              color: '#6c757d',
              mt: 0.5,
            }}
          >
            {'AI-Powered Document Intelligence'}
          </Typography>
        </Box>

        {/* Main Content */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            p: 2,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 4,
              maxWidth: 400,
              width: '100%',
              borderRadius: 3,
              border: '1px solid #e0e0e0',
            }}
          >
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  backgroundColor: '#e8f5e9',
                  mb: 2,
                }}
              >
                <LockIcon sx={{ fontSize: 32, color: '#3DB86A' }} />
              </Box>
              <Typography
                variant={'h5'}
                gutterBottom
                fontWeight={700}
                sx={{ color: '#1a1a1a' }}
              >
                {'Access Required'}
              </Typography>
              <Typography variant={'body2'} color={'text.secondary'}>
                {'Enter your email and access code to continue'}
              </Typography>
            </Box>

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label={'Email'}
                type={'email'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin={'normal'}
                required
                autoComplete={'email'}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                  },
                }}
              />
              <TextField
                fullWidth
                label={'Access Code'}
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                margin={'normal'}
                required
                autoComplete={'off'}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                  },
                }}
              />

              <Button
                type={'submit'}
                fullWidth
                variant={'contained'}
                size={'large'}
                disabled={isSubmitting}
                sx={{
                  mt: 3,
                  py: 1.5,
                  borderRadius: 2,
                  textTransform: 'none',
                  fontSize: '1rem',
                  fontWeight: 600,
                  backgroundColor: '#3DB86A',
                  '&:hover': {
                    backgroundColor: '#2A9D5C',
                  },
                }}
              >
                {isSubmitting ? <CircularProgress size={24} color={'inherit'} /> : 'Continue'}
              </Button>
            </form>
          </Paper>
        </Box>
      </Box>
    );
  }

  return children;
}
