'use client';

import { useRef, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import toast from 'react-hot-toast';
import { upload } from 'services/upload';

export default function DropBox({ onUploaded }) {
  const inputRef = useRef(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  async function handleFile(file) {
    // Guard: no file selected / empty drop.
    if (!file) {
      return;
    }
    // Optional type validation.
    if (file.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      setUploadError('Please upload a PDF file');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      const result = await upload(file);
      // Hand the freshly-allocated id back to the parent so it can show the row
      // immediately and start watching it for status changes.
      if (result && result.pdfId && onUploaded) {
        onUploaded(result.pdfId, file.name);
      }
    } catch (err) {
      const message = (err && err.message) || 'Upload failed';
      toast.error(message);
      setUploadError(message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragActive(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    const files = event.dataTransfer && event.dataTransfer.files;
    const file = files && files[0];
    handleFile(file);
  }

  function handleContainerClick() {
    if (inputRef.current) {
      inputRef.current.click();
    }
  }

  function handleButtonClick(event) {
    // Prevent the container's onClick from firing too (would open two pickers).
    event.stopPropagation();
    if (inputRef.current) {
      inputRef.current.click();
    }
  }

  function handleInputChange(event) {
    const file = event.target.files && event.target.files[0];
    handleFile(file);
  }

  return (
    <Box
      className={'drop-box'}
      onClick={handleContainerClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 2,
        p: 3,
        minWidth: '300px',
        cursor: isUploading ? 'not-allowed' : 'pointer',
        border: '2px dashed',
        borderColor: isDragActive
          ? 'var(--foreground-green)'
          : 'var(--secondary-text)',
        backgroundColor: isDragActive
          ? 'var(--background-green)'
          : 'transparent',
        transition: 'all 0.2s ease',
      }}
    >
      <Box
        component={'img'}
        src={'/upload.svg'}
        alt={''}
        sx={{ width: 80, height: 80 }}
      />

      <Typography
        sx={{
          fontWeight: 'bold',
          fontSize: '25px',
          fontFamily: 'sans-serif',
          color: 'var(--primary-text)',
        }}
      >
        {'Drop files here'}
      </Typography>

      <Typography
        sx={{
          fontSize: '16px',
          fontFamily: 'sans-serif',
          color: 'var(--secondary-text)',
        }}
      >
        {'or click to upload'}
      </Typography>

      <Button
        onClick={handleButtonClick}
        disabled={isUploading}
        sx={{
          width: '80%',
          backgroundColor: '#000000',
          color: '#ffffff',
          fontSize: '20px',
          fontFamily: 'sans-serif',
          textTransform: 'none',
          '&:hover': { backgroundColor: '#222222' },
          '&.Mui-disabled': { backgroundColor: '#555555', color: '#cccccc' },
        }}
      >
        {'+ Upload PDF'}
      </Button>

      <Typography sx={{ color: 'var(--secondary-text)' }}>
        {'PDF up to 50MB. You can drop the files here'}
      </Typography>

      {uploadError ? (
        <Typography role={'alert'} sx={{ color: '#d32f2f' }}>
          {uploadError}
        </Typography>
      ) : null}

      <input
        type={'file'}
        accept={'application/pdf'}
        ref={inputRef}
        onChange={handleInputChange}
        disabled={isUploading}
        data-testid={'drop-box-input'}
        style={{ display: 'none' }}
      />
    </Box>
  );
}
