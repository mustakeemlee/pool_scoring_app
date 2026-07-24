import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockUpload = vi.fn();
const mockUpdate = vi.fn();

vi.mock('sonner', () => {
  return {
    toast: { error: vi.fn(), success: vi.fn() },
  };
});
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    storage: { from: () => ({ upload: mockUpload }) },
    from: () => ({ update: () => ({ eq: mockUpdate }) }),
  },
}));

import { usePlayerPhotoUpload } from './usePlayerPhotoUpload';
import { toast } from 'sonner';

const mockToastError = vi.mocked(toast.error);
const mockToastSuccess = vi.mocked(toast.success);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const player = { id: 'p1', full_name: 'Alex Testplayer', photo_url: null };

describe('usePlayerPhotoUpload', () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockUpdate.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
  });

  it('rejects a non-image file without calling storage', async () => {
    const { result } = renderHook(() => usePlayerPhotoUpload(player, 's1'), { wrapper });
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.handleFile(file);
    });

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Please choose an image file.');
  });

  it('uploads an image, updates photo_url, and toasts success', async () => {
    mockUpload.mockResolvedValue({ error: null });
    mockUpdate.mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePlayerPhotoUpload(player, 's1'), { wrapper });
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.handleFile(file);
    });

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Photo updated for Alex Testplayer'));
    expect(mockUpload).toHaveBeenCalled();
  });

  it('removes the photo and toasts success', async () => {
    mockUpdate.mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePlayerPhotoUpload(player, 's1'), { wrapper });

    await act(async () => {
      await result.current.handleRemove();
    });

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Photo removed for Alex Testplayer'));
  });
});
