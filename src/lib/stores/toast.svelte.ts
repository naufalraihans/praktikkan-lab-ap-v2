/**
 * Toast notification global state pakai Svelte 5 runes.
 *
 * Usage:
 *   import { toast } from '$lib/stores/toast.svelte';
 *   toast.show('Berhasil!', 'success');
 *   toast.show('Gagal!', 'error');
 */

export type ToastType = 'success' | 'error' | 'info';

class ToastState {
  message = $state('');
  type = $state<ToastType>('info');
  visible = $state(false);

  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  show(message: string, type: ToastType = 'info', durationMs = 3000) {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.message = message;
    this.type = type;
    this.visible = true;
    this.timeoutId = setTimeout(() => {
      this.visible = false;
    }, durationMs);
  }
}

export const toast = new ToastState();
