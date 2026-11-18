import {
  CampaignSummary,
  NumbersSummaryResponse,
  ReservationDetails,
  CustomerUser,
  AdminUser,
  AdminTeamMember,
  AdminOverview,
  AdminLottery,
  PaymentSubmissionReviewItem,
  AdminReservationItem,
  AdminCustomerItem,
  CustomerDetail,
  FailedOutboxItem,
  AuditLogItem,
  NumberInventoryItem,
  PlatformSettings,
  TestChannelResult,
  PurgeCampaignResult,
  AdminDrawItem,
  DrawCommitmentItem,
  DrawVerificationData,
  AdminRefundItem,
} from '../types/index.js';

const TOKEN_KEY = 'tg_lottery_token';
const CSRF_KEY = 'tg_admin_csrf';
const ADMIN_SESSION_KEY = 'tg_admin_session';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredCsrf(): string | null {
  const stored = sessionStorage.getItem(CSRF_KEY) || localStorage.getItem(CSRF_KEY);
  if (stored) return stored;

  // Resilient fallback for mobile WebViews: Extract csrfToken from active admin session JWT
  const session = sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(TOKEN_KEY);
  if (session && session.includes('.')) {
    try {
      const parts = session.split('.');
      if (parts[1]) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.csrfToken && typeof payload.csrfToken === 'string') {
          sessionStorage.setItem(CSRF_KEY, payload.csrfToken);
          localStorage.setItem(CSRF_KEY, payload.csrfToken);
          return payload.csrfToken;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function setStoredCsrf(token: string): void {
  sessionStorage.setItem(CSRF_KEY, token);
  localStorage.setItem(CSRF_KEY, token);
}

export function clearStoredCsrf(): void {
  sessionStorage.removeItem(CSRF_KEY);
  localStorage.removeItem(CSRF_KEY);
}

export function getStoredAdminSession(): string | null {
  // Support both session-scoped and persistent mobile storage to survive Android WebView pause/resume
  return sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY);
}

export function setStoredAdminSession(token: string): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, token);
  try {
    localStorage.setItem(ADMIN_SESSION_KEY, token);
    if (token && token.includes('.')) {
      const parts = token.split('.');
      if (parts[1]) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.csrfToken && typeof payload.csrfToken === 'string') {
          sessionStorage.setItem(CSRF_KEY, payload.csrfToken);
          localStorage.setItem(CSRF_KEY, payload.csrfToken);
        }
      }
    }
  } catch {
    // ignore
  }
}

export function clearStoredAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  try {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '';

export function resolveUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const cleanBase = API_BASE_URL.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBase}${cleanEndpoint}`;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  const isAdminEndpoint = endpoint.startsWith('/admin') || endpoint.includes('/admin/');

  if (isAdminEndpoint) {
    const adminSession = getStoredAdminSession() || getStoredToken();
    if (adminSession) {
      headers.set('Authorization', `Bearer ${adminSession}`);
      headers.set('x-admin-session', adminSession);
    }
  } else {
    const token = getStoredToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const csrf = getStoredCsrf();
  const method = (options.method || 'GET').toUpperCase();
  if (csrf && !headers.has('x-csrf-token') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    headers.set('x-csrf-token', csrf);
  }

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const targetUrl = resolveUrl(endpoint);
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      credentials: 'include',
      ...options,
      headers,
    });
  } catch (fetchErr: any) {
    // If Render backend is waking from hibernation, give it 1.5s and retry once
    const isNetworkGlitch =
      fetchErr instanceof TypeError ||
      fetchErr?.message?.includes('Failed to fetch') ||
      fetchErr?.message?.includes('NetworkError');
    if (isNetworkGlitch) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await fetch(targetUrl, {
        credentials: 'include',
        ...options,
        headers,
      });
    } else {
      throw fetchErr;
    }
  }

  interface ErrorPayload {
    error?: {
      code?: string;
      message?: string;
      details?: unknown;
    };
  }

  let data: (T & ErrorPayload) | null = null;
  try {
    data = (await response.json()) as T & ErrorPayload;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const code = data?.error?.code || `HTTP_${response.status}`;
    let message = data?.error?.message || response.statusText || 'Request failed';
    if (data?.error?.details && typeof data.error.details === 'object') {
      const fieldErrors: string[] = [];
      for (const [key, val] of Object.entries(data.error.details as Record<string, any>)) {
        if (key !== '_errors' && val?._errors?.length) {
          fieldErrors.push(`${key}: ${val._errors.join(', ')}`);
        }
      }
      if (fieldErrors.length > 0) {
        message = `${message} (${fieldErrors.join(' • ')})`;
      }
    }
    throw new ApiError(response.status, code, message, data?.error?.details);
  }

  return data as T;
}



interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const memoryCache = new Map<string, CacheEntry<any>>();

export function getCached<T>(key: string, maxAgeMs: number): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > maxAgeMs) {
    return null;
  }
  return entry.data as T;
}

export function setCached<T>(key: string, data: T): void {
  memoryCache.set(key, { data, timestamp: Date.now() });
}

export function clearClientCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      memoryCache.delete(key);
    }
  }
}

export const api = {
  // 0. Customer profile
  async getMe(): Promise<CustomerUser> {
    const res = await request<CustomerUser | { user: CustomerUser }>('/me');
    if ('user' in res && (res as { user: CustomerUser }).user) {
      return (res as { user: CustomerUser }).user;
    }
    return res as CustomerUser;
  },

  // 1. Auth via Telegram InitData
  async authWithTelegram(initData: string): Promise<{ token: string; user: CustomerUser }> {
    const data = await request<{ token: string; user: CustomerUser }>('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
    setStoredToken(data.token);
    return data;
  },

  // 2. Open Campaigns (Accelerated with 15s in-memory SWR cache for 0ms transitions)
  async getOpenCampaigns(options?: { forceRefresh?: boolean }): Promise<CampaignSummary[]> {
    const cacheKey = 'open_campaigns';
    if (!options?.forceRefresh) {
      const cached = getCached<CampaignSummary[]>(cacheKey, 15000);
      if (cached) return cached;
    }
    const data = await request<CampaignSummary[]>('/lotteries');
    setCached(cacheKey, data);
    return data;
  },

  // 3. Campaign Detail
  async getCampaign(id: string): Promise<CampaignSummary> {
    return request<CampaignSummary>(`/lotteries/${id}`);
  },

  // 4. Numbers Summary (short-pollable)
  async getNumbersSummary(lotteryId: string): Promise<NumbersSummaryResponse> {
    return request<NumbersSummaryResponse>(`/lotteries/${lotteryId}/numbers-summary`);
  },

  // 5. Create Hold Reservation
  async createReservation(
    lotteryId: string,
    numbers: number[],
    idempotencyKey?: string,
  ): Promise<ReservationDetails> {
    const key = idempotencyKey || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return request<ReservationDetails>(`/lotteries/${lotteryId}/reservations`, {
      method: 'POST',
      body: JSON.stringify({
        numbers,
        idempotencyKey: key,
      }),
    });
  },

  // 6. Get Reservation details
  async getReservation(id: string): Promise<ReservationDetails> {
    return request<ReservationDetails>(`/reservations/${id}`);
  },

  // 7. Cancel Reservation
  async cancelReservation(id: string): Promise<{ success: boolean; status: string }> {
    return request<{ success: boolean; status: string }>(`/reservations/${id}/cancel`, {
      method: 'POST',
    });
  },

  // 8. Storage: get presigned upload URL
  async getPresignedUploadUrl(
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; storageKey: string; maxSizeBytes: number }> {
    return request<{ uploadUrl: string; storageKey: string; maxSizeBytes: number }>(
      '/uploads/presign',
      {
        method: 'POST',
        body: JSON.stringify({ filename, contentType }),
      },
    );
  },

  // 9. Upload File directly to presigned storage endpoint
  async uploadFileToPresignedUrl(
    uploadUrl: string,
    file: File | Blob,
    contentType: string,
  ): Promise<{ storageKey: string; fileSizeBytes: number; sha256: string }> {
    const targetUrl = resolveUrl(uploadUrl);
    const response = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: file,
    });

    if (!response.ok) {
      let errData: { error?: { code?: string; message?: string } } | null = null;
      try {
        errData = (await response.json()) as { error?: { code?: string; message?: string } };
      } catch {
        errData = null;
      }
      throw new ApiError(
        response.status,
        errData?.error?.code || 'UPLOAD_FAILED',
        errData?.error?.message || 'File upload failed',
      );
    }

    try {
      return (await response.json()) as { storageKey: string; fileSizeBytes: number; sha256: string };
    } catch {
      return { storageKey: '', fileSizeBytes: file.size, sha256: '' };
    }
  },

  // 10. Submit Payment Proof
  async submitPayment(
    reservationId: string,
    payload: {
      storageKey: string;
      originalFilename: string;
      mimeType: string;
      fileSizeBytes: number;
      fileSha256: string;
      claimedAmountMinor?: number;
      paymentReference?: string;
    },
  ): Promise<{ submissionId: string; status: string }> {
    return request<{ submissionId: string; status: string }>(
      `/reservations/${reservationId}/payment-submissions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  // 11. Customer History (Supports pagination with limit & offset)
  async getMyConfirmedTickets(params?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<ReservationDetails[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.status) query.set('status', params.status);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<ReservationDetails[]>(`/me/tickets${qs}`);
  },

  async getMyReservations(): Promise<ReservationDetails[]> {
    return request<ReservationDetails[]>('/me/reservations');
  },

  // 11b. Enterprise Session Continuity: Active Ticket Hold Recovery
  async getActiveHold(): Promise<{ activeHold: ReservationDetails | null }> {
    return request<{ activeHold: ReservationDetails | null }>('/me/active-hold');
  },

  // 12. Admin Authentication
  async adminLogin(
    email: string,
    password: string,
  ): Promise<{ sessionToken?: string; csrfToken: string; user: AdminUser; tempToken?: string }> {
    const res = await request<{ sessionToken?: string; csrfToken: string; user: AdminUser; tempToken?: string }>(
      '/admin/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
    );
    if (res.csrfToken) {
      setStoredCsrf(res.csrfToken);
    }
    if (res.sessionToken) {
      setStoredAdminSession(res.sessionToken);
    }
    return res;
  },

  async adminVerifyTotp(
    tempToken: string,
    code: string,
  ): Promise<{ sessionToken?: string; csrfToken: string; user: AdminUser }> {
    const res = await request<{ sessionToken?: string; csrfToken: string; user: AdminUser }>('/admin/auth/totp', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code }),
    });
    if (res.csrfToken) {
      setStoredCsrf(res.csrfToken);
    }
    if (res.sessionToken) {
      setStoredAdminSession(res.sessionToken);
    }
    return res;
  },

  async adminLogout(): Promise<{ success: boolean }> {
    try {
      const res = await request<{ success: boolean }>('/admin/auth/logout', { method: 'POST' });
      return res;
    } finally {
      clearStoredAdminSession();
      clearStoredCsrf();
    }
  },

  async getAdminMe(): Promise<{ admin: AdminUser }> {
    return request<{ admin: AdminUser }>('/admin/me');
  },

  async adminChangePassword(
    newPassword: string,
    currentPassword?: string,
  ): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/admin/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword, currentPassword }),
    });
  },

  // 13. Admin Overview KPIs
  async getAdminOverview(): Promise<AdminOverview> {
    return request<AdminOverview>('/admin/overview');
  },

  // 14. Admin Campaigns
  async getAdminLotteries(status?: string): Promise<AdminLottery[]> {
    const query = status && status !== 'ALL' ? `?status=${status}` : '';
    return request<AdminLottery[]>(`/admin/lotteries${query}`);
  },

  async createAdminLottery(payload: {
    slug: string;
    title: string;
    description?: string;
    prizeDescription: string;
    ticketPriceMinor: number;
    numberStart: number;
    numberEnd: number;
    maxNumbersPerPurchase?: number;
    holdMinutes?: number;
    startsAt?: string;
    endsAt?: string;
    paymentInstructions?: string;
    imageUrl?: string | null;
  }): Promise<AdminLottery> {
    return request<AdminLottery>('/admin/lotteries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateAdminLottery(
    id: string,
    payload: {
      title?: string;
      description?: string;
      prizeDescription?: string;
      ticketPriceMinor?: number;
      maxNumbersPerPurchase?: number;
      holdMinutes?: number;
      startsAt?: string;
      endsAt?: string;
      paymentInstructions?: string;
      imageUrl?: string | null;
    },
  ): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async uploadCampaignImage(
    fileOrBlob: File | Blob | string,
    filename?: string,
    campaignId?: string,
  ): Promise<{ success: boolean; url: string; storagePath?: string }> {
    // 1. If already an HTTP/HTTPS URL, return directly
    if (typeof fileOrBlob === 'string' && (fileOrBlob.startsWith('http://') || fileOrBlob.startsWith('https://'))) {
      return { success: true, url: fileOrBlob };
    }

    const resolvedFilename = filename || (fileOrBlob instanceof File ? fileOrBlob.name : 'campaign.jpg');
    let contentType = typeof fileOrBlob !== 'string' ? (fileOrBlob.type || 'image/jpeg') : 'image/jpeg';
    if (!contentType) contentType = 'image/jpeg';

    // 2. TIER 1: High-Performance Direct Presigned Upload to Supabase Storage Bucket 'campaign-images'
    let tier1Error: string | null = null;
    if (typeof fileOrBlob !== 'string') {
      try {
        const presignRes = await request<{
          success: boolean;
          uploadUrl: string;
          publicUrl: string;
          storedFileName: string;
          bucket: string;
        }>('/admin/lotteries/presign-upload', {
          method: 'POST',
          body: JSON.stringify({
            filename: resolvedFilename,
            contentType,
            campaignId,
          }),
        });

        if (presignRes?.uploadUrl && presignRes?.publicUrl) {
          const directUploadRes = await fetch(presignRes.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': contentType,
            },
            body: fileOrBlob,
          });

          if (directUploadRes.ok) {
            return {
              success: true,
              url: presignRes.publicUrl,
              storagePath: presignRes.storedFileName,
            };
          }

          const putErr = await directUploadRes.text().catch(() => '');
          tier1Error = `Supabase PUT (${directUploadRes.status}): ${putErr || directUploadRes.statusText}`;
          console.warn(`Direct Supabase upload returned ${directUploadRes.status}, falling back to backend relay:`, tier1Error);
        }
      } catch (presignErr: any) {
        tier1Error = `Presign request failed: ${presignErr?.message || presignErr}`;
        console.warn('Direct Supabase presigned upload error, falling back to backend relay:', presignErr);
      }
    }

    // 3. TIER 2: Fast Backend Upload Relay (/admin/lotteries/upload-image)
    const adminSession = getStoredAdminSession();
    const token = getStoredToken();
    const activeSession = adminSession || token;
    const csrf = getStoredCsrf();

    // If string dataUrl was passed
    if (typeof fileOrBlob === 'string' && fileOrBlob.startsWith('data:')) {
      return request<{ success: boolean; url: string; storagePath?: string }>(
        '/admin/lotteries/upload-image',
        {
          method: 'POST',
          body: JSON.stringify({
            dataUrl: fileOrBlob,
            filename: resolvedFilename,
            campaignId,
          }),
        },
      );
    }

    // Eagerly read file bytes into memory
    let fileBuffer: ArrayBuffer | null = null;
    if (fileOrBlob instanceof Blob) {
      if (typeof fileOrBlob.arrayBuffer === 'function') {
        try {
          fileBuffer = await fileOrBlob.arrayBuffer();
        } catch (bufErr) {
          console.warn('fileOrBlob.arrayBuffer() failed, will try FileReader:', bufErr);
        }
      }
      if (!fileBuffer) {
        try {
          fileBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result instanceof ArrayBuffer) resolve(reader.result);
              else reject(new Error('FileReader did not return ArrayBuffer'));
            };
            reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
            reader.readAsArrayBuffer(fileOrBlob);
          });
        } catch (readerErr) {
          console.warn('FileReader arrayBuffer failed:', readerErr);
        }
      }
    }

    let tier2Error: string | null = null;
    if (fileBuffer && fileBuffer.byteLength > 0) {
      try {
        const queryParams = new URLSearchParams();
        if (resolvedFilename) queryParams.set('filename', resolvedFilename);
        if (campaignId) queryParams.set('campaignId', campaignId);
        const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';
        const targetUrl = resolveUrl(`/admin/lotteries/upload-image${queryStr}`);

        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'x-filename': encodeURIComponent(resolvedFilename),
          'Accept': 'application/json',
        };
        if (activeSession) {
          headers['Authorization'] = `Bearer ${activeSession}`;
          headers['x-admin-session'] = activeSession;
        }
        if (csrf) {
          headers['x-csrf-token'] = csrf;
        }

        const response = await fetch(targetUrl, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: new Uint8Array(fileBuffer),
        });

        if (response.ok) {
          return (await response.json()) as { success: boolean; url: string; storagePath?: string };
        }

        const errText = await response.text().catch(() => '');
        tier2Error = `Binary relay (${response.status}): ${errText || response.statusText}`;
        console.warn(`Binary upload returned status ${response.status}, attempting JSON dataUrl fallback...`, tier2Error);
      } catch (streamErr: any) {
        tier2Error = `Binary relay error: ${streamErr?.message || streamErr}`;
        console.warn('Binary fetch failed, attempting JSON dataUrl fallback:', streamErr);
      }
    }

    // 4. TIER 3: JSON dataUrl Fallback via native FileReader (immune to call-stack overflow)
    let tier3Error: string | null = null;
    let dataUrl: string | null = null;
    if (fileOrBlob instanceof Blob) {
      try {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error || new Error('Failed to read file as data URL'));
          reader.readAsDataURL(fileOrBlob);
        });
      } catch (readErr: any) {
        tier3Error = `FileReader: ${readErr?.message || readErr}`;
        console.warn('FileReader.readAsDataURL failed:', readErr);
      }
    }

    if (dataUrl) {
      try {
        return await request<{ success: boolean; url: string; storagePath?: string }>(
          '/admin/lotteries/upload-image',
          {
            method: 'POST',
            body: JSON.stringify({
              dataUrl,
              filename: resolvedFilename,
              campaignId,
            }),
          },
        );
      } catch (reqErr: any) {
        tier3Error = reqErr?.message || String(reqErr);
      }
    }

    const detailMsg = [tier1Error, tier2Error, tier3Error].filter(Boolean).join(' | ');
    throw new Error(detailMsg || 'Upload failed across all strategies. Please check your admin session.');
  },

  async deleteCampaignImage(urlOrPath: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>('/admin/lotteries/image', {
      method: 'DELETE',
      body: JSON.stringify({ url: urlOrPath }),
    });
  },

  async publishLottery(id: string): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}/publish`, { method: 'POST' });
  },

  async pauseLottery(id: string): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}/pause`, { method: 'POST' });
  },

  async resumeLottery(id: string): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}/resume`, { method: 'POST' });
  },

  async closeLottery(id: string): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}/close`, { method: 'POST' });
  },

  async cancelLottery(id: string, reason?: string): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Cancelled by admin' }),
    });
  },

  async archiveLottery(id: string): Promise<AdminLottery> {
    return request<AdminLottery>(`/admin/lotteries/${id}/archive`, { method: 'POST' });
  },

  async deleteLottery(id: string): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>(`/admin/lotteries/${id}`, { method: 'DELETE' });
  },

  async syncLotteryToChannel(
    id: string,
  ): Promise<{ ok: boolean; message: string; channelConfigured?: boolean }> {
    return request<{ ok: boolean; message: string; channelConfigured?: boolean }>(
      `/admin/lotteries/${id}/sync-channel`,
      { method: 'POST' },
    );
  },

  // 15. Number Inventory
  async getLotteryInventory(
    lotteryId: string,
    status?: string,
    search?: number,
  ): Promise<NumberInventoryItem[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search !== undefined && !isNaN(search)) params.set('search', search.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<NumberInventoryItem[]>(`/admin/lotteries/${lotteryId}/inventory${query}`);
  },

  // 16. Payment Review (Supports pagination with limit & page)
  async getAdminSubmissions(
    status?: string,
    reservationId?: string,
    limit?: number,
    page?: number,
  ): Promise<PaymentSubmissionReviewItem[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (reservationId) params.set('reservationId', reservationId);
    if (limit) params.set('limit', String(limit));
    if (page) params.set('page', String(page));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<PaymentSubmissionReviewItem[]>(`/admin/payment-submissions${query}`);
  },

  async getAdminSubmissionEvidenceUrl(
    submissionId: string,
  ): Promise<{ downloadUrl: string; expiresAt?: string; expiresInSeconds?: number; mimeType: string }> {
    const res = await request<{ downloadUrl: string; expiresAt?: string; expiresInSeconds?: number; mimeType: string }>(
      `/admin/payment-submissions/${submissionId}/evidence-url`,
    );
    return {
      ...res,
      downloadUrl: resolveUrl(res.downloadUrl),
    };
  },

  async approvePaymentSubmission(
    submissionId: string,
    comparedWithBankRecord: boolean,
    note?: string,
  ): Promise<{ success: boolean; status: string }> {
    return request<{ success: boolean; status: string }>(
      `/admin/payment-submissions/${submissionId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ comparedWithBankRecord, note }),
      },
    );
  },

  async rejectPaymentSubmission(
    submissionId: string,
    reason: string,
    comparedWithBankRecord: boolean,
  ): Promise<{ success: boolean; status: string }> {
    return request<{ success: boolean; status: string }>(
      `/admin/payment-submissions/${submissionId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ reason, comparedWithBankRecord }),
      },
    );
  },

  async purgeCampaignPayments(
    lotteryId: string,
    mode: 'ALL' | 'PENDING_ONLY' = 'ALL',
  ): Promise<PurgeCampaignResult> {
    return request<PurgeCampaignResult>('/admin/payment-submissions/purge-campaign', {
      method: 'POST',
      body: JSON.stringify({ lotteryId, mode }),
    });
  },

  // 17. Reservations & Search
  async getAdminReservations(
    status?: string,
    search?: string,
  ): Promise<AdminReservationItem[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<AdminReservationItem[]>(`/admin/reservations${query}`);
  },

  // 18. Customers
  async getAdminCustomers(
    params?:
      | {
        search?: string;
        status?: string;
        sortBy?: string;
        sortOrder?: string;
        limit?: number;
      }
      | string,
  ): Promise<AdminCustomerItem[]> {
    if (typeof params === 'string') {
      const query = params ? `?search=${encodeURIComponent(params)}` : '';
      return request<AdminCustomerItem[]>(`/admin/customers${query}`);
    }
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.status && params.status !== 'ALL') searchParams.set('status', params.status);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<AdminCustomerItem[]>(`/admin/customers${query}`);
  },

  async getCustomerDetail(id: string): Promise<CustomerDetail> {
    return request<CustomerDetail>(`/admin/customers/${id}`);
  },

  async toggleBlockCustomer(
    id: string,
    isBlocked: boolean,
    reason?: string,
  ): Promise<{ success: boolean; isBlocked: boolean; customerId: string; message: string }> {
    return request<{ success: boolean; isBlocked: boolean; customerId: string; message: string }>(
      `/admin/customers/${id}/toggle-block`,
      {
        method: 'POST',
        body: JSON.stringify({ isBlocked, reason }),
      },
    );
  },

  // 19. Outbox & Failed Events
  async getFailedOutbox(limit = 50, offset = 0): Promise<{ events: FailedOutboxItem[]; total: number }> {
    const res = await request<{ events?: FailedOutboxItem[]; items?: FailedOutboxItem[]; total?: number }>(
      `/admin/outbox/failed?limit=${limit}&offset=${offset}`,
    );
    const eventsList = Array.isArray(res?.events)
      ? res.events
      : Array.isArray(res?.items)
        ? res.items
        : [];
    return {
      events: eventsList,
      total: typeof res?.total === 'number' ? res.total : eventsList.length,
    };
  },

  async retryFailedOutbox(id: string): Promise<{ success: boolean; event: FailedOutboxItem }> {
    return request<{ success: boolean; event: FailedOutboxItem }>(`/admin/outbox/${id}/retry`, {
      method: 'POST',
    });
  },

  // 20. Audit Trail
  async getAuditLogs(
    entityOrParams?:
      | {
        entityType?: string;
        action?: string;
        actorUserId?: string;
        search?: string;
        category?: string;
        timeframe?: string;
        limit?: number;
      }
      | string,
    legacyAction?: string,
    legacyLimit = 50,
  ): Promise<AuditLogItem[]> {
    const params = new URLSearchParams();
    if (typeof entityOrParams === 'object' && entityOrParams !== null) {
      if (entityOrParams.entityType) params.set('entityType', entityOrParams.entityType);
      if (entityOrParams.action) params.set('action', entityOrParams.action);
      if (entityOrParams.actorUserId) params.set('actorUserId', entityOrParams.actorUserId);
      if (entityOrParams.search) params.set('search', entityOrParams.search);
      if (entityOrParams.category && entityOrParams.category !== 'ALL') {
        params.set('category', entityOrParams.category);
      }
      if (entityOrParams.timeframe) {
        params.set('timeframe', entityOrParams.timeframe);
      }
      params.set('limit', (entityOrParams.limit || 100).toString());
    } else {
      if (entityOrParams) params.set('entityType', entityOrParams);
      if (legacyAction) params.set('action', legacyAction);
      params.set('limit', legacyLimit.toString());
    }
    return request<AuditLogItem[]>(`/admin/audit-logs?${params.toString()}`);
  },

  async purgeExpiredAuditLogs(): Promise<{
    success: boolean;
    purgedCount: number;
    retentionDays: number;
    cutoffDate: string;
    activeCount: number;
    message: string;
  }> {
    return request('/admin/audit-logs/purge-expired', {
      method: 'POST',
    });
  },

  // 21. Administrative Users & Settings
  async getAdminUsers(): Promise<AdminTeamMember[]> {
    return request<AdminTeamMember[]>('/admin/users');
  },

  async createAdminUser(payload: {
    telegramUserId: string;
    email: string;
    password: string;
    role?: 'ADMIN' | 'SUPERADMIN';
    firstName?: string;
    lastName?: string;
    username?: string;
  }): Promise<{ id: string; email: string; telegramUserId?: string; role: string; totpSecret: string; mustChangePassword?: boolean }> {
    return request('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ ...payload, role: payload.role || 'ADMIN' }),
    });
  },

  async deactivateAdminUser(userId: string): Promise<{ success: boolean; message: string; isDeactivated: boolean; heldRole: string }> {
    return request(`/admin/users/${userId}/deactivate`, {
      method: 'POST',
    });
  },

  async resumeAdminUser(userId: string): Promise<{ success: boolean; message: string; isDeactivated: boolean; role: string }> {
    return request(`/admin/users/${userId}/resume`, {
      method: 'POST',
    });
  },

  async deleteAdminUser(userId: string): Promise<{ success: boolean; message: string }> {
    return request(`/admin/users/${userId}`, {
      method: 'DELETE',
    });
  },

  async unlockAdminUser(userId: string): Promise<{ success: boolean; message: string }> {
    return request(`/admin/users/${userId}/reset-lockout`, {
      method: 'POST',
    });
  },

  async resetAdminUserPassword(userId: string, password: string): Promise<{ success: boolean; message: string }> {
    return request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async getAdminSettings(): Promise<PlatformSettings> {
    return request<PlatformSettings>('/admin/settings');
  },

  async updateAdminSettings(payload: Partial<PlatformSettings>): Promise<PlatformSettings> {
    return request<PlatformSettings>('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async testTelegramChannel(channelId?: string): Promise<TestChannelResult> {
    return request<TestChannelResult>('/admin/settings/test-telegram-channel', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    });
  },

  // 22. Provably Fair Draws & Announcements
  async prepareDrawCommitment(
    lotteryId: string,
    prizeLabel: string,
    drawOrder = 1,
    publicEntropy?: string,
  ): Promise<DrawCommitmentItem> {
    const res = await request<{ data: DrawCommitmentItem }>(
      `/admin/lotteries/${lotteryId}/draw-commit`,
      {
        method: 'POST',
        body: JSON.stringify({ prizeLabel, drawOrder, publicEntropy }),
      },
    );
    return res.data;
  },

  async executeCommittedDraw(
    commitmentId: string,
    publicEntropy?: string,
  ): Promise<AdminDrawItem> {
    const res = await request<{ data: AdminDrawItem }>(
      `/admin/commitments/${commitmentId}/execute`,
      {
        method: 'POST',
        body: JSON.stringify({ publicEntropy }),
      },
    );
    return res.data;
  },

  async getDrawCommitments(lotteryId: string): Promise<DrawCommitmentItem[]> {
    const res = await request<{ data: DrawCommitmentItem[] }>(
      `/admin/lotteries/${lotteryId}/commitments`,
    );
    return res.data;
  },

  async executeLotteryDraw(
    lotteryId: string,
    prizeLabel: string,
    publicEntropy?: string,
  ): Promise<AdminDrawItem> {
    const res = await request<{ data: AdminDrawItem }>(`/admin/lotteries/${lotteryId}/draw`, {
      method: 'POST',
      body: JSON.stringify({ prizeLabel, publicEntropy }),
    });
    return res.data;
  },

  async getLotteryDraws(lotteryId: string): Promise<AdminDrawItem[]> {
    const res = await request<{ data: AdminDrawItem[] }>(`/admin/lotteries/${lotteryId}/draws`);
    return res.data;
  },

  async getPublicLotteryDraws(lotteryId: string): Promise<AdminDrawItem[]> {
    return request<AdminDrawItem[]>(`/lotteries/${lotteryId}/draws`);
  },

  async getDrawVerificationData(drawId: string): Promise<DrawVerificationData> {
    const res = await request<{ data: DrawVerificationData }>(`/draws/${drawId}/verify`);
    return res.data;
  },

  async getPublicDrawSnapshot(drawId: string): Promise<any> {
    const res = await request<{ data: any }>(`/draws/${drawId}/snapshot`);
    return res.data;
  },

  async announceDraw(drawId: string): Promise<{ success: boolean; message: string }> {
    const res = await request<{ data: { success: boolean; message: string } }>(
      `/admin/draws/${drawId}/announce`,
      { method: 'POST' },
    );
    return res.data;
  },

  // 23. Refunds Queue
  async getRefunds(
    status?: string,
    lotteryId?: string,
    limit = 50,
    offset = 0,
  ): Promise<{ refunds: AdminRefundItem[]; total: number }> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (lotteryId) params.set('lotteryId', lotteryId);
    params.set('limit', limit.toString());
    params.set('offset', offset.toString());
    const res = await request<{ data: AdminRefundItem[]; total: number }>(
      `/admin/refunds?${params.toString()}`,
    );
    return { refunds: res.data, total: res.total };
  },

  async markRefundPaid(
    refundId: string,
    note?: string,
  ): Promise<{ id: string; status: string; amountMinor: string; note: string | null }> {
    const res = await request<{
      data: { id: string; status: string; amountMinor: string; note: string | null };
    }>(`/admin/refunds/${refundId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    return res.data;
  },
};
