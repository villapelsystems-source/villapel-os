import React from 'react';
import { useLanguage } from '../lib/LanguageContext';

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}) {
  const { t } = useLanguage();
  const cancelText = cancelLabel ?? t('common.cancel');
  const confirmText = confirmLabel ?? t('common.delete');
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="font-heading font-semibold text-lg text-white">
          {title}
        </h2>
        <p className="text-sm text-white/60 mt-2 whitespace-pre-wrap">{message}</p>
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-white/5 border border-white/10 text-white rounded-md px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-accent text-white hover:bg-accent-hover'
            }`}
          >
            {loading ? t('common.pleaseWait') : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
