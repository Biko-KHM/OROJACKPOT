import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Plus,
  Play,
  Pause,
  StopCircle,
  Archive,
  Ban,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Grid,
  X,
  Loader2,
  Send,
  Trophy,
  Upload,
  ShieldCheck,
  Trash2,
  Clock,
  Edit3,
  Video,
  Eye,
  Ticket,
  ExternalLink,
  Radio,
} from 'lucide-react';
import { api, ApiError } from '../../api/client.js';
import { AdminLottery, PaymentAccount, StructuredPaymentInstructions } from '../../types/index.js';
import { CustomLoader } from '../CustomLoader.js';
import { compressImageFile } from '../../utils/imageCompressor.js';

interface CampaignsViewProps {
  onInspectInventory: (lotteryId: string, title: string) => void;
}

const isImageFileType = (file: File): boolean => {
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|svg|bmp|ico|jfif|avif|heic|heif)$/i.test(file.name || '');
};

export const CampaignsView: React.FC<CampaignsViewProps> = ({ onInspectInventory }) => {
  const [campaigns, setCampaigns] = useState<AdminLottery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Create Campaign Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newPrize, setNewPrize] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriceEtb, setNewPriceEtb] = useState('100');
  const [newStart, setNewStart] = useState('0');
  const [newEnd, setNewEnd] = useState('1999');
  const [newMaxPerPurchase, setNewMaxPerPurchase] = useState('20');
  const [newHoldMinutes, setNewHoldMinutes] = useState('10');
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([
    {
      id: 'acc-1',
      type: 'bank',
      title: 'Commercial Bank of Ethiopia (CBE)',
      accountNumber: '',
      accountName: 'OROJACKPOT Official CBE Account',
    },
  ]);
  const [paymentNote, setPaymentNote] = useState<string>(
    'Please upload your payment screenshot after completing transfer.',
  );

  const handleUpdateAccount = (
    id: string,
    field: keyof PaymentAccount,
    value: string,
  ) => {
    setPaymentAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== id) return acc;
        const updated = { ...acc, [field]: value };
        if (field === 'title') {
          updated.type = /telebirr|phone|mobile/i.test(value) ? 'telebirr' : 'bank';
        }
        return updated;
      }),
    );
  };

  const handleAddAccount = () => {
    if (paymentAccounts.length >= 4) return;
    const newId = `acc-${Date.now()}`;
    const nextDefaultTitle = paymentAccounts.length === 1 ? 'Telebirr SuperApp Transfer' : '';
    const nextDefaultNumber = paymentAccounts.length === 1 ? '' : '';
    const nextDefaultName = paymentAccounts.length === 1 ? 'OROJACKPOT Official Telebirr' : '';
    const isTelebirr = /telebirr|phone|mobile/i.test(nextDefaultTitle);
    const newAcc: PaymentAccount = {
      id: newId,
      type: isTelebirr ? 'telebirr' : 'bank',
      title: nextDefaultTitle,
      accountNumber: nextDefaultNumber,
      accountName: nextDefaultName,
    };
    setPaymentAccounts((prev) => [...prev, newAcc]);
  };

  const handleRemoveAccount = (id: string) => {
    setPaymentAccounts((prev) => prev.filter((acc) => acc.id !== id));
  };
  const [newImageUrl, setNewImageUrl] = useState<string>('');
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isImageFileType(file)) {
      setCreateError('Selected file must be an image (PNG, JPG, WebP, GIF, etc.)');
      return;
    }

    setIsUploadingImage(true);
    setCreateError(null);

    // Instant local preview via ObjectURL
    let tempBlobUrl: string | null = null;
    try {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        tempBlobUrl = URL.createObjectURL(file);
        setLocalPreviewUrl(tempBlobUrl);
      }
    } catch {
      // ignore preview failure
    }

    try {
      // Client-side auto-optimization: Resizes camera photos down to max 1200px (150KB - 300KB)
      // Eliminates mobile Telegram upload drops and 'failed to fetch' errors
      const optimizedBlob = await compressImageFile(file, {
        maxDimension: 1200,
        quality: 0.85,
        mimeType: 'image/jpeg',
      });

      if (optimizedBlob.size > 10 * 1024 * 1024) {
        setCreateError('Image file is too large (maximum limit is 10MB)');
        setIsUploadingImage(false);
        return;
      }

      // Upload directly to Supabase Storage bucket 'campaign-images'
      const uploadRes = await api.uploadCampaignImage(optimizedBlob, file.name);
      setNewImageUrl(uploadRes.url);
      setLocalPreviewUrl(null);
    } catch (err: unknown) {
      console.error('Image upload failed:', err);
      setLocalPreviewUrl(null);
      setNewImageUrl('');
      const rawMsg = err instanceof Error ? err.message : '';
      if (rawMsg.includes('permission') || rawMsg.includes('NotReadableError') || rawMsg.includes('could not be read')) {
        setCreateError(
          'Could not read the selected photo from device storage. If stored in Google Photos or cloud drive, ' +
          'please download it to your gallery first, or paste the image URL directly in the field below.',
        );
      } else if (rawMsg === 'Failed to fetch' || rawMsg === 'NetworkError') {
        setCreateError(
          'Backend connection failed. The server may be waking up from sleep. Please wait 10 seconds and try uploading again.',
        );
      } else {
        setCreateError(rawMsg || 'Failed to upload image file to Supabase Storage');
      }
    } finally {
      if (tempBlobUrl) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(tempBlobUrl!);
          } catch {
            // ignore
          }
        }, 1500);
      }
      setIsUploadingImage(false);
      try {
        e.target.value = '';
      } catch {
        // ignore
      }
    }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  };

  // Edit Campaign Modal state
  const [editingLottery, setEditingLottery] = useState<AdminLottery | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrize, setEditPrize] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriceEtb, setEditPriceEtb] = useState('100');
  const [editMaxPerPurchase, setEditMaxPerPurchase] = useState('20');
  const [editHoldMinutes, setEditHoldMinutes] = useState('10');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [localEditPreviewUrl, setLocalEditPreviewUrl] = useState<string | null>(null);
  const [isUploadingEditImage, setIsUploadingEditImage] = useState(false);
  const [editPaymentAccounts, setEditPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [editPaymentNote, setEditPaymentNote] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Manual Draw Modal state
  const [manualDrawLottery, setManualDrawLottery] = useState<AdminLottery | null>(null);
  const [drawWinningNumber, setDrawWinningNumber] = useState('');
  const [drawPrizeLabel, setDrawPrizeLabel] = useState('');
  const [drawLiveUrl, setDrawLiveUrl] = useState('');
  const [isSavingLiveUrl, setIsSavingLiveUrl] = useState(false);
  const [drawVideoFile, setDrawVideoFile] = useState<File | null>(null);
  const [isSubmittingDraw, setIsSubmittingDraw] = useState(false);
  const [drawSubmitError, setDrawSubmitError] = useState<string | null>(null);
  const [drawUploadProgress, setDrawUploadProgress] = useState<string | null>(null);

  // Standalone Upload / Replace Draw Video Modal state
  const [uploadVideoLottery, setUploadVideoLottery] = useState<AdminLottery | null>(null);
  const [videoFileToUpload, setVideoFileToUpload] = useState<File | null>(null);
  const [isUploadingVideoStandalone, setIsUploadingVideoStandalone] = useState(false);
  const [uploadVideoStandaloneError, setUploadVideoStandaloneError] = useState<string | null>(null);

  // Preview Video Modal state
  const [previewVideoModal, setPreviewVideoModal] = useState<{ url: string; title: string } | null>(null);

  const handleOpenEdit = (camp: AdminLottery) => {
    setEditingLottery(camp);
    setEditTitle(camp.title);
    setEditPrize(camp.prizeDescription || '');
    setEditDesc(camp.description || '');
    setEditPriceEtb((Number(camp.ticketPriceMinor || 0) / 100).toFixed(2));
    setEditMaxPerPurchase(String(camp.maxNumbersPerPurchase || 20));
    setEditHoldMinutes(String(camp.holdMinutes || 10));
    setEditImageUrl(camp.imageUrl || '');
    setLocalEditPreviewUrl(null);
    setUpdateError(null);
    try {
      if (camp.paymentInstructions) {
        const parsed = JSON.parse(camp.paymentInstructions);
        if (parsed && Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
          setEditPaymentAccounts(parsed.accounts);
          setEditPaymentNote(parsed.note || '');
          return;
        }
      }
    } catch {
      // fallback
    }
    setEditPaymentAccounts(paymentAccounts);
    setEditPaymentNote(paymentNote);
  };

  const handleEditImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isImageFileType(file)) {
      setUpdateError('Selected file must be an image (PNG, JPG, WebP, GIF, etc.)');
      return;
    }

    setIsUploadingEditImage(true);
    setUpdateError(null);

    let tempBlobUrl: string | null = null;
    try {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        tempBlobUrl = URL.createObjectURL(file);
        setLocalEditPreviewUrl(tempBlobUrl);
      }
    } catch {
      // ignore preview failure
    }

    try {
      const optimizedBlob = await compressImageFile(file, {
        maxDimension: 1200,
        quality: 0.85,
        mimeType: 'image/jpeg',
      });

      if (optimizedBlob.size > 10 * 1024 * 1024) {
        setUpdateError('Image file is too large (maximum limit is 10MB)');
        setIsUploadingEditImage(false);
        return;
      }

      const uploadRes = await api.uploadCampaignImage(optimizedBlob, file.name, editingLottery?.id);
      setEditImageUrl(uploadRes.url);
      setLocalEditPreviewUrl(null);
    } catch (err: unknown) {
      console.error('Edit image upload failed:', err);
      setLocalEditPreviewUrl(null);
      const rawMsg = err instanceof Error ? err.message : '';
      if (rawMsg.includes('permission') || rawMsg.includes('NotReadableError') || rawMsg.includes('could not be read')) {
        setUpdateError(
          'Could not read the selected photo from device storage. If stored in Google Photos or cloud drive, ' +
          'please download it to your gallery first, or paste the image URL directly in the field below.',
        );
      } else if (rawMsg === 'Failed to fetch' || rawMsg === 'NetworkError') {
        setUpdateError(
          'Backend connection failed. The server may be waking up from sleep. Please wait 10 seconds and try uploading again.',
        );
      } else {
        setUpdateError(rawMsg || 'Failed to upload image file to Supabase Storage');
      }
    } finally {
      if (tempBlobUrl) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(tempBlobUrl!);
          } catch {
            // ignore
          }
        }, 1500);
      }
      setIsUploadingEditImage(false);
      try {
        e.target.value = '';
      } catch {
        // ignore
      }
    }
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLottery) return;
    setUpdateError(null);
    setIsUpdating(true);

    const priceMinor = Math.round(parseFloat(editPriceEtb) * 100);
    const maxPerPurchase = parseInt(editMaxPerPurchase, 10);
    const holdMins = parseInt(editHoldMinutes, 10);

    if (isNaN(priceMinor) || priceMinor <= 0) {
      setUpdateError('Invalid ticket price');
      setIsUpdating(false);
      return;
    }

    if (isNaN(maxPerPurchase) || maxPerPurchase < 1 || maxPerPurchase > 100) {
      setUpdateError('Max numbers per user must be between 1 and 100');
      setIsUpdating(false);
      return;
    }

    if (isNaN(holdMins) || holdMins < 1 || holdMins > 60) {
      setUpdateError('Hold time must be between 1 and 60 minutes');
      setIsUpdating(false);
      return;
    }

    const paymentPayload: StructuredPaymentInstructions = {
      accounts: editPaymentAccounts.map((acc) => ({
        id: acc.id,
        type: acc.type,
        title: acc.title.trim(),
        accountNumber: acc.accountNumber.trim(),
        accountName: acc.accountName.trim(),
      })),
      note: editPaymentNote.trim() || undefined,
    };

    try {
      await api.updateAdminLottery(editingLottery.id, {
        title: editTitle.trim(),
        prizeDescription: editPrize.trim(),
        description: editDesc.trim() || undefined,
        ticketPriceMinor: priceMinor,
        maxNumbersPerPurchase: maxPerPurchase,
        holdMinutes: holdMins,
        imageUrl: editImageUrl.trim() || null,
        paymentInstructions: JSON.stringify(paymentPayload),
      });

      setActionSuccess('Campaign prize and details updated successfully!');
      setEditingLottery(null);
      await fetchCampaigns();
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsUpdating(false);
    }
  };

  const fetchCampaigns = useCallback(async (silent = false) => {
    if (!silent && campaigns.length === 0) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    try {
      const data = await api.getAdminLotteries(undefined, { forceRefresh: !silent });
      setCampaigns(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: unknown) {
      if (campaigns.length === 0) {
        setError(err instanceof Error ? err.message : 'Failed to fetch campaigns');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [campaigns.length]);

  useEffect(() => {
    void fetchCampaigns(campaigns.length > 0);
  }, []);

  const handlePublish = async (id: string) => {
    if (!window.confirm('Publish this campaign? This generates number inventory atomically and opens sales.')) return;
    setActionLoadingId(id);
    setActionSuccess(null);
    try {
      await api.publishLottery(id);
      setActionSuccess('Campaign published successfully!');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePause = async (id: string) => {
    setActionLoadingId(id);
    try {
      await api.pauseLottery(id);
      setActionSuccess('Campaign paused.');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Pause failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleResume = async (id: string) => {
    setActionLoadingId(id);
    try {
      await api.resumeLottery(id);
      setActionSuccess('Campaign resumed.');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleClose = async (id: string) => {
    if (!window.confirm('Close ticket sales for this campaign? No new holds can be made.')) return;
    setActionLoadingId(id);
    try {
      await api.closeLottery(id);
      setActionSuccess('Campaign closed for ticket sales.');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSyncChannel = async (id: string) => {
    setActionLoadingId(id);
    setActionSuccess(null);
    try {
      const res = await api.syncLotteryToChannel(id);
      if (res.channelConfigured === false) {
        alert(
          '⚠️ Telegram Channel is not configured.\n\nPlease go to Superadmin Settings -> "Telegram Channel & Auto-Posting" to enter your channel username (e.g. @YourChannel), click "Save Platform Settings", and verify wiring with the bot added as an Administrator.',
        );
      } else {
        setActionSuccess('📢 Telegram channel post synced successfully with latest remaining numbers and status!');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to sync to Telegram channel');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (id: string) => {
    const reason = window.prompt('Enter reason for cancelling this campaign (creates refund records):');
    if (!reason) return;
    setActionLoadingId(id);
    try {
      await api.cancelLottery(id, reason);
      setActionSuccess('Campaign cancelled.');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchive = async (id: string) => {
    if (!window.confirm('Archive this campaign?')) return;
    setActionLoadingId(id);
    try {
      await api.archiveLottery(id);
      setActionSuccess('Campaign archived.');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteCampaign = async (id: string, title: string) => {
    const confirmMsg = `Are you sure you want to PERMANENTLY DELETE "${title}"?\n\nThis will completely erase the campaign, its numbers, ticket records, and its uploaded image from Supabase Storage.\n\nThis action cannot be undone!`;
    if (!window.confirm(confirmMsg)) return;

    setActionLoadingId(id);
    try {
      const res = await api.deleteLottery(id);
      setActionSuccess(res.message || 'Campaign permanently deleted.');
      await fetchCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete campaign');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenManualDraw = (camp: AdminLottery) => {
    setManualDrawLottery(camp);
    setDrawWinningNumber('');
    setDrawPrizeLabel(camp.prizeDescription || '');
    setDrawLiveUrl(camp.drawLiveUrl || '');
    setDrawVideoFile(null);
    setDrawSubmitError(null);
    setDrawUploadProgress(null);
  };

  const handleSaveLiveUrlOnly = async () => {
    if (!manualDrawLottery) return;
    setIsSavingLiveUrl(true);
    setDrawSubmitError(null);
    try {
      await api.setLotteryLiveStream(manualDrawLottery.id, drawLiveUrl.trim());
      setActionSuccess(`🔴 Live stream link updated for "${manualDrawLottery.title}"! Mini app customers can now watch the draw live.`);
      await fetchCampaigns();
    } catch (err: unknown) {
      setDrawSubmitError(err instanceof Error ? err.message : 'Failed to save live stream URL');
    } finally {
      setIsSavingLiveUrl(false);
    }
  };

  const handleManualDrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDrawLottery) return;
    setDrawSubmitError(null);

    const winningNum = parseInt(drawWinningNumber.trim(), 10);
    if (isNaN(winningNum)) {
      setDrawSubmitError('Please enter a valid winning ticket number.');
      return;
    }
    if (winningNum < manualDrawLottery.numberStart || winningNum > manualDrawLottery.numberEnd) {
      setDrawSubmitError(
        `Winning number #${winningNum} is outside the campaign range (#${manualDrawLottery.numberStart} – #${manualDrawLottery.numberEnd}).`,
      );
      return;
    }

    if (drawVideoFile && drawVideoFile.size > 50 * 1024 * 1024) {
      setDrawSubmitError('Video file exceeds the 50MB limit allowed for Telegram Bot CDN storage.');
      return;
    }

    setIsSubmittingDraw(true);
    let uploadedKey: string | undefined = undefined;

    try {
      if (drawVideoFile) {
        setDrawUploadProgress('Uploading draw video to Telegram Bot CDN (free storage)...');
        const uploadRes = await api.uploadDrawVideo(manualDrawLottery.id, drawVideoFile);
        uploadedKey = uploadRes.drawVideoUrl;
      }

      setDrawUploadProgress('Finalizing manual draw and recording winner...');
      await api.completeManualDraw(manualDrawLottery.id, {
        winningNumber: winningNum,
        prizeLabel: drawPrizeLabel.trim() || undefined,
        drawVideoUrl: uploadedKey,
        drawLiveUrl: drawLiveUrl.trim() || undefined,
      });

      setActionSuccess(`🎉 Manual draw completed for "${manualDrawLottery.title}"! Winner ticket #${winningNum} announced.`);
      setManualDrawLottery(null);
      await fetchCampaigns();
    } catch (err: unknown) {
      setDrawSubmitError(err instanceof Error ? err.message : 'Failed to complete manual draw');
    } finally {
      setIsSubmittingDraw(false);
      setDrawUploadProgress(null);
    }
  };

  const handleOpenUploadVideo = (camp: AdminLottery) => {
    setUploadVideoLottery(camp);
    setVideoFileToUpload(null);
    setUploadVideoStandaloneError(null);
  };

  const handleUploadVideoStandaloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadVideoLottery || !videoFileToUpload) return;
    setUploadVideoStandaloneError(null);

    if (videoFileToUpload.size > 50 * 1024 * 1024) {
      setUploadVideoStandaloneError('Video file exceeds the 50MB limit allowed for Telegram Bot CDN storage.');
      return;
    }

    setIsUploadingVideoStandalone(true);
    try {
      await api.uploadDrawVideo(uploadVideoLottery.id, videoFileToUpload);
      setActionSuccess(`🎬 Draw video uploaded to Telegram Bot CDN for "${uploadVideoLottery.title}"! Users can now verify the draw.`);
      setUploadVideoLottery(null);
      await fetchCampaigns();
    } catch (err: unknown) {
      setUploadVideoStandaloneError(err instanceof Error ? err.message : 'Failed to upload draw video');
    } finally {
      setIsUploadingVideoStandalone(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    const priceMinor = Math.round(parseFloat(newPriceEtb) * 100);
    const start = parseInt(newStart, 10);
    const end = parseInt(newEnd, 10);
    const maxPerPurchase = parseInt(newMaxPerPurchase, 10);
    const holdMins = parseInt(newHoldMinutes, 10);

    if (isNaN(priceMinor) || priceMinor <= 0) {
      setCreateError('Invalid ticket price');
      setIsCreating(false);
      return;
    }

    if (isNaN(start) || start < 0) {
      setCreateError('Start # must be 0 or greater');
      setIsCreating(false);
      return;
    }

    if (isNaN(end) || end < start) {
      setCreateError('End # must be greater than or equal to start');
      setIsCreating(false);
      return;
    }

    if (end - start >= 10000) {
      setCreateError('Maximum numbers allowed per campaign is 10,000');
      setIsCreating(false);
      return;
    }

    if (isNaN(maxPerPurchase) || maxPerPurchase < 1 || maxPerPurchase > 100) {
      setCreateError('Max numbers per user must be between 1 and 100');
      setIsCreating(false);
      return;
    }

    if (isNaN(holdMins) || holdMins < 1 || holdMins > 60) {
      setCreateError('Hold time must be between 1 and 60 minutes');
      setIsCreating(false);
      return;
    }

    const paymentPayload: StructuredPaymentInstructions = {
      accounts: paymentAccounts.map((acc) => ({
        id: acc.id,
        type: acc.type,
        title: acc.title.trim(),
        accountNumber: acc.accountNumber.trim(),
        accountName: acc.accountName.trim(),
      })),
      note: paymentNote.trim() || undefined,
    };

    // Generate clean alphanumeric slug with hyphen support, falling back to clean timestamp
    const rawSlug = (newSlug.trim() || newTitle.trim())
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const finalSlug = rawSlug.length >= 3 ? rawSlug : `camp-${Date.now().toString(36)}`;

    try {
      const created = await api.createAdminLottery({
        title: newTitle.trim(),
        slug: finalSlug,
        prizeDescription: newPrize.trim(),
        description: newDesc.trim() || undefined,
        imageUrl: newImageUrl.trim() || undefined,
        ticketPriceMinor: priceMinor,
        numberStart: start,
        numberEnd: end,
        maxNumbersPerPurchase: maxPerPurchase,
        holdMinutes: holdMins,
        paymentInstructions: JSON.stringify(paymentPayload),
      });

      if (publishImmediately && created?.id) {
        try {
          await api.publishLottery(created.id);
          setActionSuccess(`Campaign "${created.title}" created & published! Live sales are now OPEN.`);
        } catch (pubErr) {
          setActionSuccess(
            `Campaign "${created.title}" created as draft, but auto-publish encountered an issue: ${
              pubErr instanceof Error ? pubErr.message : 'Please click Publish manually.'
            }`,
          );
        }
      } else {
        setActionSuccess(
          `Draft campaign "${created?.title || newTitle}" created! Review and click "Publish" to open sales.`,
        );
      }

      setIsCreateModalOpen(false);
      setStatusFilter('ALL');
      // Reset form
      setNewTitle('');
      setNewSlug('');
      setNewPrize('');
      setNewDesc('');
      setNewImageUrl('');
      setLocalPreviewUrl(null);
      setPaymentAccounts([
        {
          id: 'acc-1',
          type: 'bank',
          title: 'Commercial Bank of Ethiopia (CBE)',
          accountNumber: '',
          accountName: 'OROJACKPOT Official CBE Account',
        },
      ]);
      setPaymentNote('Please upload your payment screenshot after completing transfer.');
      await fetchCampaigns();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setCreateError(err.message || 'Creation failed');
      } else {
        setCreateError('Failed to create campaign');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const filteredCampaigns = (Array.isArray(campaigns) ? campaigns : []).filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        c.prizeDescription.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">OPEN</span>;
      case 'DRAFT':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>DRAFT • COMING SOON</span>
          </span>
        );
      case 'PAUSED':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-500/15 text-amber-400 border border-amber-500/30">PAUSED</span>;
      case 'CLOSED':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-blue-500/15 text-blue-400 border border-blue-500/30">CLOSED</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-purple-500/15 text-purple-400 border border-purple-500/30">COMPLETED</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-500/15 text-rose-400 border border-rose-500/30">CANCELLED</span>;
      case 'ARCHIVED':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-slate-900 text-slate-500 border border-slate-800">ARCHIVED</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Campaign Manager</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure lottery rules, prizes, pricing, and lifecycle states
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => void fetchCampaigns(false)}
            disabled={isLoading || isRefreshing}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create Campaign</span>
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 font-bold">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
          {['ALL', 'OPEN', 'DRAFT', 'PAUSED', 'CLOSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Campaigns List */}
      {isLoading && campaigns.length === 0 ? (
        <CustomLoader
          fullScreen={false}
          message="Loading campaigns"
          subtitle="Fetching active and historical lottery campaigns"
        />
      ) : filteredCampaigns.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 rounded-3xl border border-slate-800/80 text-slate-400 text-xs">
          No campaigns found matching filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredCampaigns.map((camp) => {
            const ticketPriceFormatted = (Number(camp.ticketPriceMinor || 0) / 100).toFixed(2);
            const totalNumbers = camp.numberEnd - camp.numberStart + 1;
            const isBusy = actionLoadingId === camp.id;

            return (
              <div
                key={camp.id}
                className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {camp.imageUrl ? (
                      <img
                        src={camp.imageUrl}
                        alt={camp.prizeDescription || camp.title}
                        className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl object-cover border border-[#123c2a] shadow-sm shadow-[#00d26a]/20 shrink-0 bg-[#0c251b]"
                      />
                    ) : (
                      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center shrink-0 shadow-sm shadow-[#00d26a]/20">
                        <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-[#00d26a]" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-base font-extrabold text-white leading-tight">{camp.title}</h3>
                        {getStatusBadge(camp.status)}
                        {camp.status === 'COMPLETED' && (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                            <Trophy className="w-3 h-3 text-amber-400" />
                            <span>Winner: #{camp.winningNumber ?? camp.latestDraw?.winningNumber ?? '—'}</span>
                          </span>
                        )}
                        {camp.status === 'COMPLETED' && camp.drawVideoUrl && (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Video className="w-3 h-3 text-emerald-400" />
                            <span>Video Attached</span>
                          </span>
                        )}
                        {camp.status === 'COMPLETED' && !camp.drawVideoUrl && (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-rose-400" />
                            <span>Video Missing</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-emerald-400 font-semibold mt-0.5 truncate">
                        Prize: {camp.prizeDescription}
                      </p>
                      {camp.description && (
                        <p className="text-xs text-slate-400 mt-1 max-w-2xl">{camp.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <div className="text-sm font-black text-white">{ticketPriceFormatted} ETB</div>
                    <div className="text-[11px] text-slate-400">per ticket</div>
                  </div>
                </div>

                {/* Organized Campaign Parameters Matrix */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                  <div className="bg-[#131923] border border-[#1a2230] rounded-xl p-2.5 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                      <Ticket className="w-3 h-3 text-[#00d26a]" />
                      <span>Ticket Range</span>
                    </span>
                    <span className="font-bold text-white font-mono mt-0.5 text-xs truncate">
                      #{camp.numberStart} – #{camp.numberEnd}
                    </span>
                    <span className="text-[9.5px] text-slate-400">
                      {totalNumbers.toLocaleString()} tickets total
                    </span>
                  </div>

                  <div className="bg-[#131923] border border-[#1a2230] rounded-xl p-2.5 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                      <Layers className="w-3 h-3 text-indigo-400" />
                      <span>Max Purchase</span>
                    </span>
                    <span className="font-bold text-white font-mono mt-0.5 text-xs">
                      {camp.maxNumbersPerPurchase} tickets
                    </span>
                    <span className="text-[9.5px] text-slate-400">
                      per transaction
                    </span>
                  </div>

                  <div className="bg-[#131923] border border-[#1a2230] rounded-xl p-2.5 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span>Hold Timeout</span>
                    </span>
                    <span className="font-bold text-white font-mono mt-0.5 text-xs">
                      {camp.holdMinutes} minutes
                    </span>
                    <span className="text-[9.5px] text-slate-400">
                      auto-release timer
                    </span>
                  </div>

                  <div className="bg-[#131923] border border-[#1a2230] rounded-xl p-2.5 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                      <ExternalLink className="w-3 h-3 text-sky-400" />
                      <span>Campaign Slug</span>
                    </span>
                    <span className="font-bold text-emerald-400 font-mono mt-0.5 text-xs truncate">
                      /{camp.slug}
                    </span>
                    <span className="text-[9.5px] text-slate-400">
                      mini app link path
                    </span>
                  </div>
                </div>

                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => onInspectInventory(camp.id, camp.title)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-bold transition-colors"
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span>Inspect Inventory</span>
                    </button>

                    {camp.status !== 'ARCHIVED' && camp.status !== 'COMPLETED' && (
                      <button
                        onClick={() => handleOpenEdit(camp)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/10 hover:bg-amber-600/20 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors active:scale-95"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                        <span>Edit Prize & Details</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* DRAFT -> Publish */}
                    {camp.status === 'DRAFT' && (
                      <button
                        onClick={() => void handlePublish(camp.id)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        <span>Publish</span>
                      </button>
                    )}

                    {/* OPEN -> Pause, Close */}
                    {camp.status === 'OPEN' && (
                      <>
                        <button
                          onClick={() => void handlePause(camp.id)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </button>
                        <button
                          onClick={() => void handleClose(camp.id)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold transition-colors"
                        >
                          <StopCircle className="w-3.5 h-3.5" />
                          <span>Close Sales</span>
                        </button>
                      </>
                    )}

                    {/* PAUSED -> Resume, Close */}
                    {camp.status === 'PAUSED' && (
                      <>
                        <button
                          onClick={() => void handleResume(camp.id)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Resume</span>
                        </button>
                        <button
                          onClick={() => void handleClose(camp.id)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold transition-colors"
                        >
                          <StopCircle className="w-3.5 h-3.5" />
                          <span>Close Sales</span>
                        </button>
                      </>
                    )}

                    {/* Sync Channel (for OPEN, PAUSED, CLOSED) */}
                    {['OPEN', 'PAUSED', 'CLOSED'].includes(camp.status) && (
                      <button
                        onClick={() => void handleSyncChannel(camp.id)}
                        disabled={isBusy}
                        title="Broadcast / sync remaining numbers and status to Telegram Channel"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        <span>Sync Channel</span>
                      </button>
                    )}

                    {/* OPEN, PAUSED, CLOSED -> Complete Manual Draw & Finish */}
                    {['OPEN', 'PAUSED', 'CLOSED'].includes(camp.status) && (
                      <button
                        onClick={() => handleOpenManualDraw(camp)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-emerald-500/20 hover:from-amber-500/30 hover:to-emerald-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all shadow-sm active:scale-95"
                        title="Enter offline manual draw winning number and attach draw video"
                      >
                        <Trophy className="w-3.5 h-3.5 text-amber-400" />
                        <span>Manual Draw & Finish</span>
                      </button>
                    )}

                    {/* COMPLETED -> Upload / Replace Draw Video */}
                    {camp.status === 'COMPLETED' && (
                      <>
                        <button
                          onClick={() => handleOpenUploadVideo(camp)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-bold transition-all shadow-sm active:scale-95"
                          title="Upload or replace manual draw video (stored on Telegram Bot CDN)"
                        >
                          <Video className="w-3.5 h-3.5 text-purple-400" />
                          <span>{camp.drawVideoUrl ? 'Replace Draw Video' : 'Upload Draw Video'}</span>
                        </button>
                        {camp.drawVideoUrl && (
                          <button
                            onClick={() =>
                              setPreviewVideoModal({
                                url: api.getDrawVideoPlaybackUrl(camp.id),
                                title: camp.title,
                              })
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all shadow-sm active:scale-95"
                            title="Preview draw video streaming from Telegram Bot CDN"
                          >
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Watch Draw Video</span>
                          </button>
                        )}
                      </>
                    )}

                    {/* OPEN, PAUSED, CLOSED -> Cancel */}
                    {['OPEN', 'PAUSED', 'CLOSED'].includes(camp.status) && (
                      <button
                        onClick={() => void handleCancel(camp.id)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-bold transition-colors"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}

                    {/* DRAFT, COMPLETED, CANCELLED -> Archive */}
                    {['DRAFT', 'COMPLETED', 'CANCELLED'].includes(camp.status) && (
                      <button
                        onClick={() => void handleArchive(camp.id)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archive</span>
                      </button>
                    )}

                    {/* ARCHIVED -> Permanent Delete (Final Act) */}
                    {camp.status === 'ARCHIVED' && (
                      <button
                        onClick={() => void handleDeleteCampaign(camp.id, camp.title)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition-all shadow-sm active:scale-95"
                        title="Permanently erase this archived campaign and all its database records"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Delete Campaign</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Campaign Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div className="w-full max-w-[560px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">
            <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-white font-extrabold text-sm">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Create New Lottery Campaign</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4 space-y-3">
              {createError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {createError}
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                  Campaign Title *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="e.g. Ethiopian Meskel Grand Draw 2026"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                    Slug / URL Path
                  </label>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    onFocus={handleInputFocus}
                    placeholder="e.g. meskel-draw-2026"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                    Set Price of Each Ticket (ETB) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={newPriceEtb}
                    onChange={(e) => setNewPriceEtb(e.target.value)}
                    onFocus={handleInputFocus}
                    placeholder="100.00"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                  />
                  <span className="text-[10px] text-slate-500">Wired to card badge (e.g. +{parseFloat(newPriceEtb || '0').toFixed(2)} ETB)</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                  Prize of the Chance (Grand Prize) *
                </label>
                <input
                  type="text"
                  required
                  value={newPrize}
                  onChange={(e) => setNewPrize(e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="e.g. Abbaan carraa 1000 nyaata or 1,000,000 ETB + Car"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <span className="text-[10px] text-slate-500">Prominently shown as main prize title on the campaign card</span>
              </div>

              {/* Live Preview of Campaign Card (Matching Customer View) */}
              <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-900/50 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                  <span>Customer Card Preview</span>
                  <span className="text-emerald-400 font-mono text-[9px] bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">Live Preview</span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080b10] border border-[#123c2a] flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {(localPreviewUrl || newImageUrl) ? (
                      <img src={localPreviewUrl || newImageUrl} alt="Prize" className="w-10 h-10 rounded-xl object-cover border border-[#123c2a] bg-[#0c251b] shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shrink-0">
                        <Trophy className="w-5 h-5 text-[#00d26a]" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="text-xs font-extrabold text-white truncate">
                        {newPrize || 'Prize of the Chance'}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {newTitle || 'Campaign Title'}
                      </p>
                    </div>
                  </div>
                  <div className="px-2.5 py-1 rounded-xl bg-[#0c251b] border border-[#123c2a] shrink-0">
                    <span className="text-xs font-black text-emerald-400 font-mono">
                      +{parseFloat(newPriceEtb || '0').toFixed(2)} ETB
                    </span>
                  </div>
                </div>
              </div>

              {/* Campaign / Prize Image Upload & Live Preview in Trophy Footprint */}
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Campaign Prize Image <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <span className="text-[10px] text-slate-500">Rendered in trophy icon place</span>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Live Thumbnail Preview */}
                  <div className="shrink-0">
                    {(localPreviewUrl || newImageUrl) ? (
                      <div className="relative group">
                        <img
                          src={localPreviewUrl || newImageUrl}
                          alt="Prize Preview"
                          className="w-10 h-10 rounded-xl object-cover border border-[#123c2a] shadow-sm shadow-[#00d26a]/20 bg-[#0c251b]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setNewImageUrl('');
                            setLocalPreviewUrl(null);
                          }}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center text-[10px] shadow"
                          title="Remove image"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="fulus-icon-box-green w-10 h-10 shadow-sm shadow-[#00d26a]/20 flex items-center justify-center rounded-xl bg-[#0c251b] border border-[#123c2a]">
                        <Trophy className="w-5 h-5 text-[#00d26a]" />
                      </div>
                    )}
                  </div>

                  {/* Upload button or URL input */}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <label
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold cursor-pointer transition-colors active:scale-95 ${
                          isUploadingImage ? 'pointer-events-none opacity-60' : ''
                        }`}
                      >
                        <Upload className="w-3 h-3 text-emerald-400" />
                        <span>{isUploadingImage ? 'Processing...' : 'Upload Image'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageFileChange}
                          className="hidden"
                        />
                      </label>
                      {(newImageUrl || localPreviewUrl) && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewImageUrl('');
                            setLocalPreviewUrl(null);
                          }}
                          className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold px-2 py-0.5 rounded hover:bg-rose-500/10 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <input
                      type="url"
                      value={newImageUrl.startsWith('data:') ? '' : newImageUrl}
                      onChange={(e) => {
                        setNewImageUrl(e.target.value);
                        setLocalPreviewUrl(null);
                      }}
                      onFocus={handleInputFocus}
                      placeholder="Or paste image URL (https://...)"
                      className="w-full px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  {newImageUrl || localPreviewUrl
                    ? '✓ Custom image will appear on the campaign card in place of trophy.'
                    : 'ℹ If unassigned, the green trophy icon shown above will be used.'}
                </p>
              </div>

              {/* Numbers Grid: Start #, End #, Max / User, Hold (min) */}
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-0.5 text-center sm:text-left">Start #</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    onFocus={handleInputFocus}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-0.5 text-center sm:text-left">End #</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    onFocus={handleInputFocus}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-0.5 text-center sm:text-left">Max/User</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={newMaxPerPurchase}
                    onChange={(e) => setNewMaxPerPurchase(e.target.value)}
                    onFocus={handleInputFocus}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-0.5 text-center sm:text-left">Hold (min)</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    required
                    value={newHoldMinutes}
                    onChange={(e) => setNewHoldMinutes(e.target.value)}
                    onFocus={handleInputFocus}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Payment Accounts Configurator (Streamlined 3-field rows, up to 4 accounts) */}
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <label className="text-[11px] font-bold text-slate-200">
                      Payment Accounts <span className="text-slate-500 font-normal">({paymentAccounts.length}/4)</span>
                    </label>
                  </div>
                  {paymentAccounts.length < 4 ? (
                    <button
                      type="button"
                      onClick={handleAddAccount}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-0.5 hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Another ({paymentAccounts.length}/4)</span>
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-medium">(Max 4 accounts)</span>
                  )}
                </div>

                {/* Column Headers for sm screens */}
                <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-1 text-[10px] font-bold text-slate-400">
                  <span className="sm:col-span-4">Bank / Institution Name *</span>
                  <span className="sm:col-span-4">Account / Phone Number *</span>
                  <span className={paymentAccounts.length > 1 ? "sm:col-span-3" : "sm:col-span-4"}>Name Associated</span>
                  {paymentAccounts.length > 1 && <span className="sm:col-span-1"></span>}
                </div>

                {/* Account Rows */}
                <div className="space-y-1.5">
                  {paymentAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex flex-col sm:grid sm:grid-cols-12 gap-1.5 sm:gap-2 items-stretch sm:items-center p-1.5 sm:p-2 rounded-xl bg-[#131923] border border-slate-800/90"
                    >
                      {/* Bank / Institution Name */}
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          required
                          value={acc.title}
                          onChange={(e) => handleUpdateAccount(acc.id, 'title', e.target.value)}
                          onFocus={handleInputFocus}
                          placeholder="Institution (e.g. CBE, Telebirr)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                      </div>

                      {/* Account Number */}
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          required
                          value={acc.accountNumber}
                          onChange={(e) => handleUpdateAccount(acc.id, 'accountNumber', e.target.value)}
                          onFocus={handleInputFocus}
                          placeholder="Account / Phone #"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono font-semibold text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                      </div>

                      {/* Name Associated */}
                      <div className={paymentAccounts.length > 1 ? "sm:col-span-3" : "sm:col-span-4"}>
                        <input
                          type="text"
                          value={acc.accountName}
                          onChange={(e) => handleUpdateAccount(acc.id, 'accountName', e.target.value)}
                          onFocus={handleInputFocus}
                          placeholder="Name Associated (Beneficiary)"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                      </div>

                      {/* Delete button (if > 1 accounts) */}
                      {paymentAccounts.length > 1 && (
                        <div className="sm:col-span-1 flex justify-end sm:justify-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveAccount(acc.id)}
                            className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remove account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <input
                    type="text"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    onFocus={handleInputFocus}
                    placeholder="Payment note / deposit instructions (optional)"
                    className="w-full px-2.5 py-1 rounded-lg bg-slate-900/60 border border-slate-800/80 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Campaign Status / Mode Selector (Draft vs Publish Live) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPublishImmediately(false)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    !publishImmediately
                      ? 'bg-amber-500/15 border-amber-500/50 text-white shadow-sm shadow-amber-500/10'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className={`w-3.5 h-3.5 ${!publishImmediately ? 'text-amber-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold">Save as Draft</span>
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-black uppercase">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Saves campaign. Shown as &quot;Coming Soon&quot; on Mini App without opening ticket reservations.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPublishImmediately(true)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    publishImmediately
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-white shadow-sm shadow-emerald-500/10'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Play className={`w-3.5 h-3.5 ${publishImmediately ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold">Publish Live Now</span>
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-black uppercase">
                      Live Sales
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Generates inventory ({parseInt(newEnd, 10) - parseInt(newStart, 10) + 1 || 0} tickets) and immediately makes lottery live.
                  </p>
                </button>
              </div>
            </div>

            {/* Action Buttons Footer - Cleanly docked at the bottom of the card */}
            <div className="px-4 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating || isUploadingImage}
                className={`px-4 py-1.5 rounded-lg text-white font-bold text-xs shadow-md flex items-center gap-1.5 disabled:opacity-50 transition-colors ${
                  publishImmediately
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                    : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                }`}
              >
                {isCreating || isUploadingImage ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : publishImmediately ? (
                  <Play className="w-3.5 h-3.5" />
                ) : (
                  <Clock className="w-3.5 h-3.5" />
                )}
                <span>
                  {isUploadingImage
                    ? 'Uploading Image...'
                    : isCreating
                    ? 'Creating...'
                    : publishImmediately
                    ? 'Create & Publish Live'
                    : 'Save Draft Campaign (Coming Soon)'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

      {/* Edit Campaign Modal */}
      {editingLottery && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div className="w-full max-w-[560px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">
            <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-white font-extrabold text-sm">
                <Edit3 className="w-4 h-4 text-amber-400" />
                <span>Edit Prize & Campaign Details</span>
                <span className="text-[10px] text-slate-400 font-mono">/{editingLottery.slug}</span>
              </div>
              <button
                type="button"
                onClick={() => setEditingLottery(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4 space-y-3">
              {updateError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {updateError}
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                  Campaign Title *
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="e.g. Ethiopian Meskel Grand Draw 2026"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                  Prize of the Chance (Grand Prize) *
                </label>
                <input
                  type="text"
                  required
                  value={editPrize}
                  onChange={(e) => setEditPrize(e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="e.g. Abbaan carraa 1000 nyaata or 1,000,000 ETB + Car"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <span className="text-[10px] text-slate-500">Prominently shown as main prize title on the campaign card</span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                  Set Price of Each Ticket (ETB) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={editPriceEtb}
                  onChange={(e) => setEditPriceEtb(e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="100.00"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                />
                <span className="text-[10px] text-slate-500">Wired to card badge (e.g. +{parseFloat(editPriceEtb || '0').toFixed(2)} ETB)</span>
              </div>

              {/* Live Preview of Campaign Card (Matching Customer View) */}
              <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-900/50 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                  <span>Customer Card Preview</span>
                  <span className="text-emerald-400 font-mono text-[9px] bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">Live Preview</span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#080b10] border border-[#123c2a] flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {(localEditPreviewUrl || editImageUrl) ? (
                      <img src={localEditPreviewUrl || editImageUrl} alt="Prize" className="w-10 h-10 rounded-xl object-cover border border-[#123c2a] bg-[#0c251b] shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-[#0c251b] border border-[#123c2a] flex items-center justify-center text-[#00d26a] shrink-0">
                        <Trophy className="w-5 h-5 text-[#00d26a]" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="text-xs font-extrabold text-white truncate">
                        {editPrize || 'Prize of the Chance'}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {editTitle || 'Campaign Title'}
                      </p>
                    </div>
                  </div>
                  <div className="px-2.5 py-1 rounded-xl bg-[#0c251b] border border-[#123c2a] shrink-0">
                    <span className="text-xs font-black text-emerald-400 font-mono">
                      +{parseFloat(editPriceEtb || '0').toFixed(2)} ETB
                    </span>
                  </div>
                </div>
              </div>

              {/* Campaign / Prize Image Upload */}
              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Campaign Prize Image <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <span className="text-[10px] text-slate-500">Rendered in trophy icon place</span>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="shrink-0">
                    {(localEditPreviewUrl || editImageUrl) ? (
                      <div className="relative group">
                        <img
                          src={localEditPreviewUrl || editImageUrl}
                          alt="Prize Preview"
                          className="w-10 h-10 rounded-xl object-cover border border-[#123c2a] shadow-sm shadow-[#00d26a]/20 bg-[#0c251b]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEditImageUrl('');
                            setLocalEditPreviewUrl(null);
                          }}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center text-[10px] shadow"
                          title="Remove image"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="fulus-icon-box-green w-10 h-10 shadow-sm shadow-[#00d26a]/20 flex items-center justify-center rounded-xl bg-[#0c251b] border border-[#123c2a]">
                        <Trophy className="w-5 h-5 text-[#00d26a]" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <label
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold cursor-pointer transition-colors active:scale-95 ${
                          isUploadingEditImage ? 'pointer-events-none opacity-60' : ''
                        }`}
                      >
                        <Upload className="w-3 h-3 text-emerald-400" />
                        <span>{isUploadingEditImage ? 'Processing...' : 'Upload Image'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleEditImageFileChange}
                          className="hidden"
                        />
                      </label>
                      {(editImageUrl || localEditPreviewUrl) && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditImageUrl('');
                            setLocalEditPreviewUrl(null);
                          }}
                          className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold px-2 py-0.5 rounded hover:bg-rose-500/10 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <input
                      type="url"
                      value={editImageUrl.startsWith('data:') ? '' : editImageUrl}
                      onChange={(e) => {
                        setEditImageUrl(e.target.value);
                        setLocalEditPreviewUrl(null);
                      }}
                      onFocus={handleInputFocus}
                      placeholder="Or paste image URL (https://...)"
                      className="w-full px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-0.5">
                  Detailed Description <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="Official lottery rules, terms, drawing details..."
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              {/* Max Per User & Hold Minutes */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-0.5">Max Tickets / User</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={editMaxPerPurchase}
                    onChange={(e) => setEditMaxPerPurchase(e.target.value)}
                    onFocus={handleInputFocus}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-0.5">Hold Time (minutes)</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    required
                    value={editHoldMinutes}
                    onChange={(e) => setEditHoldMinutes(e.target.value)}
                    onFocus={handleInputFocus}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-center text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              </div>

              {/* Action Buttons Footer - Cleanly docked at the bottom of the card */}
              <div className="px-4 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingLottery(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating || isUploadingEditImage}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-1.5 disabled:opacity-50 transition-colors active:scale-95"
                >
                  {isUpdating || isUploadingEditImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                  <span>{isUploadingEditImage ? 'Uploading Image...' : isUpdating ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Manual Draw Modal */}
      {manualDrawLottery && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">Manual Draw & Finish</h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[280px]">{manualDrawLottery.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSubmittingDraw && setManualDrawLottery(null)}
                disabled={isSubmittingDraw}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleManualDrawSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {drawSubmitError && (
                  <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{drawSubmitError}</span>
                  </div>
                )}

                {drawUploadProgress && (
                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2 animate-pulse">
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                    <span>{drawUploadProgress}</span>
                  </div>
                )}

                <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800/80 text-[11px] text-slate-300 space-y-1">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>Campaign Number Range:</span>
                    <span className="font-mono text-emerald-400">
                      #{manualDrawLottery.numberStart} – #{manualDrawLottery.numberEnd}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[10px]">
                    The draw will mark this campaign as COMPLETED and announce the manual winner to customers.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">
                    Winning Ticket Number *
                  </label>
                  <input
                    type="number"
                    min={manualDrawLottery.numberStart}
                    max={manualDrawLottery.numberEnd}
                    required
                    value={drawWinningNumber}
                    onChange={(e) => setDrawWinningNumber(e.target.value)}
                    placeholder={`e.g. ${Math.floor((manualDrawLottery.numberStart + manualDrawLottery.numberEnd) / 2)}`}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Enter the ticket number drawn during your offline physical lottery event.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">
                    Prize Label <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={drawPrizeLabel}
                    onChange={(e) => setDrawPrizeLabel(e.target.value)}
                    placeholder="e.g. 1st Grand Prize (Car)"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                      <span>Live Draw Stream Link (TikTok, YouTube, Facebook Live)</span>
                      <span className="text-slate-500 font-normal text-[10px]">(Optional)</span>
                    </label>
                    {drawLiveUrl.trim() && (
                      <button
                        type="button"
                        onClick={() => void handleSaveLiveUrlOnly()}
                        disabled={isSavingLiveUrl || isSubmittingDraw}
                        className="text-[10px] px-2.5 py-0.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold transition-all active:scale-95 disabled:opacity-50"
                      >
                        {isSavingLiveUrl ? 'Saving...' : 'Broadcast Live Link Now'}
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    value={drawLiveUrl}
                    onChange={(e) => setDrawLiveUrl(e.target.value)}
                    placeholder="e.g. https://www.tiktok.com/@orojackpot/live or https://youtube.com/live/..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    If this chance is being drawn on TikTok or social live, paste the link here. Mini app users can click &quot;View the Draw Process / Watch Live&quot; to tune in.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">
                    Draw Video Recording <span className="text-slate-500 font-normal">(Optional, max 50MB)</span>
                  </label>
                  <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <input
                      type="file"
                      accept="video/*,video/mp4,video/quicktime,video/webm"
                      id="manual-draw-video-input"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setDrawVideoFile(file);
                      }}
                    />
                    <label
                      htmlFor="manual-draw-video-input"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold cursor-pointer transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>{drawVideoFile ? 'Change Video File' : 'Select Draw Video'}</span>
                    </label>

                    {drawVideoFile && (
                      <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                        <div className="flex items-center gap-2 min-w-0">
                          <Video className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="truncate">{drawVideoFile.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            ({(drawVideoFile.size / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDrawVideoFile(null)}
                          className="text-rose-400 hover:text-rose-300 text-xs ml-2 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      💡 Video is hosted directly on Telegram Bot CDN ($0 storage cost). Customers can click &quot;Verify the Draw&quot; on the card to watch it. You can also upload or replace it anytime later.
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-900/90 border-t border-slate-800 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSubmittingDraw}
                  onClick={() => setManualDrawLottery(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDraw}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 text-white font-extrabold text-xs shadow-lg shadow-amber-600/20 flex items-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                >
                  {isSubmittingDraw ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Completing Draw...</span>
                    </>
                  ) : (
                    <>
                      <Trophy className="w-3.5 h-3.5" />
                      <span>Announce Winner & Finish</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload / Replace Draw Video Modal */}
      {uploadVideoLottery && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                  <Video className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">
                    {uploadVideoLottery.drawVideoUrl ? 'Replace Draw Video' : 'Upload Draw Video'}
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[280px]">{uploadVideoLottery.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isUploadingVideoStandalone && setUploadVideoLottery(null)}
                disabled={isUploadingVideoStandalone}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadVideoStandaloneSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {uploadVideoStandaloneError && (
                  <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{uploadVideoStandaloneError}</span>
                  </div>
                )}

                <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">Winner Ticket:</span>
                    <span className="font-mono text-amber-400 font-extrabold">
                      #{uploadVideoLottery.winningNumber ?? uploadVideoLottery.latestDraw?.winningNumber ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Current Video Status:</span>
                    <span className={uploadVideoLottery.drawVideoUrl ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                      {uploadVideoLottery.drawVideoUrl ? 'Attached on Telegram CDN' : 'Pending Upload'}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">
                    Select Video File (MP4, MOV, WebM - Max 50MB) *
                  </label>
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                    <input
                      type="file"
                      accept="video/*,video/mp4,video/quicktime,video/webm"
                      id="standalone-draw-video-input"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setVideoFileToUpload(file);
                      }}
                    />
                    <label
                      htmlFor="standalone-draw-video-input"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer shadow-md shadow-purple-600/20 transition-all active:scale-95"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{videoFileToUpload ? 'Choose Different Video' : 'Browse Video File'}</span>
                    </label>

                    {videoFileToUpload && (
                      <div className="flex items-center justify-between text-xs text-slate-200 bg-slate-900 p-3 rounded-xl border border-purple-500/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <Video className="w-4 h-4 text-purple-400 shrink-0" />
                          <span className="truncate font-medium">{videoFileToUpload.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            ({(videoFileToUpload.size / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setVideoFileToUpload(null)}
                          className="text-rose-400 hover:text-rose-300 text-xs ml-2 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-900/30 text-[10px] text-purple-300 leading-relaxed">
                      💡 <strong>Telegram Bot Storage:</strong> Video files are sent to your Telegram bot channel/chat and hosted on Telegram&apos;s high-speed CDN with zero database storage costs, supporting full HTTP range video seeking for customers.
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-900/90 border-t border-slate-800 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isUploadingVideoStandalone}
                  onClick={() => setUploadVideoLottery(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!videoFileToUpload || isUploadingVideoStandalone}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs shadow-lg shadow-purple-600/20 flex items-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                >
                  {isUploadingVideoStandalone ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading to Telegram...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload to Telegram CDN</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Video Playback Modal */}
      {previewVideoModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white truncate max-w-md">
                  Draw Verification Video: {previewVideoModal.title}
                </span>
              </div>
              <button
                onClick={() => setPreviewVideoModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-black p-2 flex items-center justify-center">
              <video
                controls
                autoPlay
                playsInline
                className="w-full max-h-[70vh] rounded-2xl bg-black"
                src={previewVideoModal.url}
              >
                Your browser does not support the video tag.
              </video>
            </div>
            <div className="px-4 py-2.5 bg-slate-900/90 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Streaming from Telegram Bot CDN</span>
              <button
                onClick={() => setPreviewVideoModal(null)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
