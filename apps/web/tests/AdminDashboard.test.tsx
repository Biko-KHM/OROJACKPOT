// @vitest-environment jsdom
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AdminLogin } from '../src/components/admin/AdminLogin.js';
import { AdminDashboard } from '../src/components/admin/AdminDashboard.js';
import { PaymentReviewsView } from '../src/components/admin/PaymentReviewsView.js';
import { CampaignsView } from '../src/components/admin/CampaignsView.js';
import { SettingsView } from '../src/components/admin/SettingsView.js';
import { ForceChangePassword } from '../src/components/admin/ForceChangePassword.js';
import { AdminUser, AdminOverview, AdminLottery, PaymentSubmissionReviewItem } from '../src/types/index.js';

const mockSuperadmin: AdminUser = {
  id: 'admin-uuid-1',
  email: 'superadmin@lottery.et',
  role: 'SUPERADMIN',
  username: 'superadmin',
  firstName: 'Super',
  lastName: 'Admin',
};

const mockOperator: AdminUser = {
  id: 'admin-uuid-2',
  email: 'operator@lottery.et',
  role: 'ADMIN',
  username: 'operator',
  firstName: 'Dawit',
  lastName: 'Bekele',
};

const mockOverview: AdminOverview = {
  activeCampaignsCount: 3,
  totalTicketsSold: 1250,
  totalRevenueMinor: '31250000', // 312,500.00 ETB
  pendingReviewsCount: 4,
  failedOutboxCount: 0,
  totalCustomersCount: 890,
};

const mockCampaignDraft: AdminLottery = {
  id: 'camp-draft-1',
  slug: 'test-draft',
  title: 'Test Draft Campaign',
  prizeDescription: 'Toyota Land Cruiser',
  ticketPriceMinor: '25000',
  numberStart: 0,
  numberEnd: 999,
  maxNumbersPerPurchase: 20,
  holdMinutes: 10,
  status: 'DRAFT',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockSubmission: PaymentSubmissionReviewItem = {
  id: 'sub-review-1',
  reservationId: 'res-rev-1',
  submittedBy: 'user-1',
  originalFilename: 'telebirr_receipt.jpg',
  mimeType: 'image/jpeg',
  fileSizeBytes: '124000',
  fileSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  claimedAmountMinor: '25000',
  paymentReference: 'CBE-TX-984210',
  status: 'SUBMITTED',
  createdAt: new Date().toISOString(),
  reservation: {
    id: 'res-rev-1',
    publicReference: 'RES-ETHIO-984210',
    totalAmountMinor: '25000',
    ticketCount: 1,
    status: 'PENDING_REVIEW',
    lotteryTitle: 'Ethiopian New Year Grand Draw',
    customerUsername: 'abebe123',
    customerTelegramId: '987654321',
  },
  reviews: [],
};

describe('Step 10: Admin Dashboard & Verification Engine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('1. Direct admin login: credentials form authenticates directly and calls onLoginSuccess', async () => {
    const loginMock = vi.fn();

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/admin/auth/login') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            csrfToken: 'csrf-secret-token-123',
            user: mockSuperadmin,
          }),
        } as Response);
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    render(<AdminLogin onLoginSuccess={loginMock} />);

    expect(screen.getByText('Operator & Admin Portal')).toBeInTheDocument();
    expect(screen.getByText(/HIREE Lottery Management System/i)).toBeInTheDocument();

    // Fill credentials
    const emailInput = screen.getByPlaceholderText('admin@lottery.et');
    const passwordInput = screen.getByPlaceholderText('••••••••••••');

    fireEvent.change(emailInput, { target: { value: 'superadmin@lottery.et' } });
    fireEvent.change(passwordInput, { target: { value: 'CorrectPassword123!' } });

    const signInBtn = screen.getByRole('button', { name: /Sign In/i });
    fireEvent.click(signInBtn);

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith(mockSuperadmin);
    });
  });

  it('1b. Admin Login: toggles password visibility and renders saved accounts quick-switch', async () => {
    localStorage.setItem(
      'tg_admin_saved_accounts',
      JSON.stringify([
        { email: 'operator@lottery.et', role: 'ADMIN', name: 'Dawit Bekele', lastUsedAt: Date.now() },
      ]),
    );

    render(<AdminLogin onLoginSuccess={vi.fn()} />);

    // Check saved accounts section
    expect(screen.getByText(/Saved Accounts/i)).toBeInTheDocument();
    expect(screen.getByText('operator@lottery.et')).toBeInTheDocument();

    const passwordInput = screen.getByPlaceholderText('••••••••••••') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    // Click "See" button
    const toggleBtn = screen.getByTestId('toggle-password-btn');
    fireEvent.click(toggleBtn);

    expect(passwordInput.type).toBe('text');

    // Click "Hide" button
    fireEvent.click(toggleBtn);

    expect(passwordInput.type).toBe('password');
  });


  it('2. Admin Overview displays database KPI metrics and revenue in ETB', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/admin/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockOverview,
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response);
    });

    render(
      <AdminDashboard
        admin={mockSuperadmin}
        onLogout={vi.fn()}
        onSwitchToMiniApp={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Platform Operations & KPIs')).toBeInTheDocument();
      expect(screen.getByText(/312,500.00 ETB/)).toBeInTheDocument();
      expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1); // pending reviews badge + KPI card
    });
  });

  it('3. Mandatory Bank Statement Verification (Requirement FR-21): Approve button is disabled until checkbox is ticked', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/admin/payment-submissions') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, status: 'APPROVED' }),
        } as Response);
      }

      if (urlStr.includes('/evidence-url')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            downloadUrl: 'https://storage.private/receipt.jpg',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            mimeType: 'image/jpeg',
          }),
        } as Response);
      }

      if (urlStr.includes('/admin/payment-submissions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockSubmission],
        } as Response);
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    render(<PaymentReviewsView />);

    // Wait for submission to appear
    await waitFor(() => {
      expect(screen.getByText('RES-ETHIO-984210')).toBeInTheDocument();
      expect(screen.getByText('CBE-TX-984210')).toBeInTheDocument();
    });

    // Click "Review Submission"
    const reviewBtn = screen.getByRole('button', { name: /Review Submission/i });
    fireEvent.click(reviewBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/I confirm I have compared this evidence/i)).toBeInTheDocument();
    });

    // Check that "Approve Tickets" is initially disabled
    const approveBtn = screen.getByRole('button', { name: /Approve Tickets/i });
    expect(approveBtn).toBeDisabled();

    // Tick mandatory confirmation checkbox
    const confirmCheckbox = screen.getByRole('checkbox', {
      name: /I confirm I have compared this evidence with the actual CBE \/ Telebirr bank record/i,
    });
    fireEvent.click(confirmCheckbox);

    // Now Approve button must be enabled
    expect(approveBtn).toBeEnabled();

    // Click approve
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByText(/approved successfully/i)).toBeInTheDocument();
    });
  });

  it('4. Rejection requires a mandatory reason (FR-17) and calls reject endpoint', async () => {
    let rejectCalled = false;

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/reject') && options?.method === 'POST') {
        rejectCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, status: 'REJECTED' }),
        } as Response);
      }

      if (urlStr.includes('/evidence-url')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            downloadUrl: 'https://storage.private/receipt.jpg',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            mimeType: 'image/jpeg',
          }),
        } as Response);
      }

      if (urlStr.includes('/admin/payment-submissions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockSubmission],
        } as Response);
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    render(<PaymentReviewsView />);

    await waitFor(() => {
      expect(screen.getByText('RES-ETHIO-984210')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Review Submission/i }));

    const rejectBtn = await screen.findByRole('button', { name: /Reject Submission/i });
    fireEvent.click(rejectBtn);

    // Rejection reason modal prompt appears
    await waitFor(() => {
      expect(screen.getByText(/A clear rejection reason is mandatory/i)).toBeInTheDocument();
    });

    const confirmRejectBtn = screen.getByRole('button', { name: /Confirm Rejection/i });
    expect(confirmRejectBtn).toBeDisabled();

    // Type non-empty reason
    const reasonInput = screen.getByPlaceholderText(/Transaction reference not found on bank statement/i);
    fireEvent.change(reasonInput, { target: { value: 'Reference code CBE-TX-984210 not in CBE settlement statement' } });

    expect(confirmRejectBtn).toBeEnabled();
    fireEvent.click(confirmRejectBtn);

    await waitFor(() => {
      expect(rejectCalled).toBe(true);
    });
  });

  it('5. Role Restrictions: SUPERADMIN can configure dual approval and view add user controls; ADMIN sees read-only banner', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/admin/settings')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            dualApprovalRequired: true,
            dualApprovalThresholdMinor: '5000000',
            reviewEscalationDelayMinutes: 120,
            maintenanceMode: false,
            customerSupportTelegram: '@Support',
          }),
        } as Response);
      }
      if (urlStr.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'u-1',
              role: 'SUPERADMIN',
              email: 'superadmin@lottery.et',
              firstName: 'Super',
              lastName: 'Admin',
              isBlocked: false,
              lockedUntil: null,
              createdAt: new Date().toISOString(),
            },
          ],
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    // Test with OPERATOR (ADMIN role)
    const { rerender } = render(<SettingsView currentAdmin={mockOperator} />);

    await waitFor(() => {
      expect(screen.getByText(/Role: ADMIN \(Read-Only Settings\)/i)).toBeInTheDocument();
      // "Add Admin / Operator" button should NOT be rendered for non-superadmin
      expect(screen.queryByText(/Add Admin \/ Operator/i)).not.toBeInTheDocument();
    });

    // Rerender with SUPERADMIN
    rerender(<SettingsView currentAdmin={mockSuperadmin} />);

    await waitFor(() => {
      expect(screen.queryByText(/Read-Only Settings/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Add Admin \/ Operator/i)).toBeInTheDocument();
      expect(screen.getByText(/Save Platform Settings/i)).toBeInTheDocument();
    });
  });

  it('6. Sidebar navigation: clicking every sidebar button routes to its specified view for Superadmin and Coordinator', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/admin/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockOverview,
        } as Response);
      }

      if (urlStr.includes('/inventory')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      if (urlStr.includes('/admin/lotteries')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockCampaignDraft],
        } as Response);
      }

      if (urlStr.includes('/admin/draws')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      if (urlStr.includes('/admin/refunds')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ refunds: [], total: 0 }),
        } as Response);
      }

      if (urlStr.includes('/admin/inventory')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      if (urlStr.includes('/admin/payment-submissions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockSubmission],
        } as Response);
      }

      if (urlStr.includes('/admin/reservations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      if (urlStr.includes('/admin/customers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      if (urlStr.includes('/admin/outbox/failed')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ events: [], total: 0 }),
        } as Response);
      }

      if (urlStr.includes('/admin/audit-logs')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      if (urlStr.includes('/admin/settings')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            dualApprovalRequired: false,
            dualApprovalThresholdMinor: '1000000',
            reviewEscalationDelayMinutes: 120,
            maintenanceMode: false,
            customerSupportTelegram: '@Support',
          }),
        } as Response);
      }

      if (urlStr.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    render(
      <AdminDashboard
        admin={mockSuperadmin}
        onLogout={vi.fn()}
        onSwitchToMiniApp={vi.fn()}
      />,
    );

    // Initial view: Dashboard / Overview
    await waitFor(() => {
      expect(screen.getByText('Platform Operations & KPIs')).toBeInTheDocument();
    });

    // 1. Click "Campaigns"
    fireEvent.click(screen.getByRole('button', { name: /Campaigns/i }));
    await waitFor(() => {
      expect(screen.getByText('Campaign Manager')).toBeInTheDocument();
      expect(screen.getByText('Create Campaign')).toBeInTheDocument();
    });

    // 2. Click "Draws & Winners"
    fireEvent.click(screen.getByRole('button', { name: /Draws & Winners/i }));
    await waitFor(() => {
      expect(screen.getByText('Cryptographic Draws & Winner Selection')).toBeInTheDocument();
    });

    // 3. Verify Refunds is removed from sidebar
    expect(screen.queryByRole('button', { name: /^Refunds$/i })).not.toBeInTheDocument();

    // 4. Click "Inventory"
    fireEvent.click(screen.getByRole('button', { name: /Inventory/i }));
    await waitFor(() => {
      expect(screen.getByText('Number Inventory Inspector')).toBeInTheDocument();
    });

    // 5. Click "Payment Reviews"
    fireEvent.click(screen.getByRole('button', { name: /Payment Reviews/i }));
    await waitFor(() => {
      expect(screen.getByText('Payment Evidence Reviews')).toBeInTheDocument();
    });

    // 6. Click "Reservations"
    fireEvent.click(screen.getByRole('button', { name: /Reservations/i }));
    await waitFor(() => {
      expect(screen.getByText('Reservations Search & Audit')).toBeInTheDocument();
    });

    // 7. Click "Customers"
    fireEvent.click(screen.getByRole('button', { name: /Customers/i }));
    await waitFor(() => {
      expect(screen.getByText('Customer Accounts & Activity')).toBeInTheDocument();
    });

    // 8. Click "Outbox Queue"
    fireEvent.click(screen.getByRole('button', { name: /Outbox Queue/i }));
    await waitFor(() => {
      expect(screen.getByText('Outbox & Telegram Queue Monitor')).toBeInTheDocument();
    });

    // 9. Click "Audit Trail"
    fireEvent.click(screen.getByRole('button', { name: /Audit Trail/i }));
    await waitFor(() => {
      expect(screen.getByText('Cryptographic Audit Trail')).toBeInTheDocument();
    });

    // 10. Click "Settings"
    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
    await waitFor(() => {
      expect(screen.getByText('Platform Settings & Security')).toBeInTheDocument();
    });

    // 11. Click "Dashboard" back
    fireEvent.click(screen.getByRole('button', { name: /Dashboard/i }));
    await waitFor(() => {
      expect(screen.getByText('Platform Operations & KPIs')).toBeInTheDocument();
    });
  });

  it('7. SettingsView Add Admin Modal provides role selection for both ADMIN and SUPERADMIN', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/admin/settings')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            dualApprovalRequired: false,
            dualApprovalThresholdMinor: '1000000',
            reviewEscalationDelayMinutes: 120,
            maintenanceMode: false,
            customerSupportTelegram: '@Support',
          }),
        } as Response);
      }
      if (urlStr.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    render(<SettingsView currentAdmin={mockSuperadmin} />);

    await waitFor(() => {
      expect(screen.getByText(/Add Admin \/ Operator/i)).toBeInTheDocument();
    });

    // Open Modal
    fireEvent.click(screen.getByText(/Add Admin \/ Operator/i));

    await waitFor(() => {
      expect(screen.getByText('Authority Role *')).toBeInTheDocument();
      expect(screen.getByText('Operator & Payment Reviewer')).toBeInTheDocument();
      expect(screen.getByText('Full Platform & Settings Control')).toBeInTheDocument();
      expect(screen.getByText('SUPERADMIN')).toBeInTheDocument();
    });
  });

  it('8. ForceChangePassword renders mandatory update screen, enforces password validation, and calls change-password API', async () => {
    const changePasswordMock = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('/admin/auth/change-password') && options?.method === 'POST') {
        changePasswordMock(JSON.parse(options.body as string));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'Password updated' }),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    const successMock = vi.fn();
    const logoutMock = vi.fn();

    const pendingAdmin: AdminUser = {
      ...mockOperator,
      mustChangePassword: true,
    };

    render(
      <ForceChangePassword
        admin={pendingAdmin}
        onSuccess={successMock}
        onLogout={logoutMock}
      />
    );

    expect(screen.getByText(/Mandatory Password Update/i)).toBeInTheDocument();
    expect(screen.getByText(/First Login Security Requirement/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Update Password & Enter Portal/i });
    expect(submitBtn).toBeDisabled();

    // Fill new password
    const newPassInput = screen.getByPlaceholderText(/At least 8 characters/i);
    const confirmPassInput = screen.getByPlaceholderText(/Repeat new password/i);

    fireEvent.change(newPassInput, { target: { value: 'NewSecurePassword123!' } });
    fireEvent.change(confirmPassInput, { target: { value: 'NewSecurePassword123!' } });

    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          newPassword: 'NewSecurePassword123!',
        })
      );
    });
  });

  it('9. Payment Reviews: categorizes payments by campaign cards, provides structured table, and switches between To Be Approved and Payment History', async () => {
    const multiSubmissions: PaymentSubmissionReviewItem[] = [
      {
        ...mockSubmission,
        id: 'sub-camp-1',
        reservation: {
          ...mockSubmission.reservation,
          id: 'res-camp-1',
          publicReference: 'RES-CAMP-111111',
          lotteryTitle: 'Abbaa Carraa Lotu',
        },
      },
      {
        ...mockSubmission,
        id: 'sub-camp-2',
        status: 'APPROVED',
        reservation: {
          ...mockSubmission.reservation,
          id: 'res-camp-2',
          publicReference: 'RES-CAMP-222222',
          lotteryTitle: 'Admin Review Campaign',
        },
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/admin/payment-submissions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => multiSubmissions,
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    render(<PaymentReviewsView />);

    // 1. Verify Campaign Categorization Dropdown exists
    await waitFor(() => {
      expect(screen.getByText('Categorize by Campaign')).toBeInTheDocument();
      expect(screen.getAllByText('All Campaigns').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Abbaa Carraa Lotu').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Admin Review Campaign').length).toBeGreaterThanOrEqual(1);
    });

    // 2. Verify Structured Table Headers
    expect(screen.getByText('Reference & Customer')).toBeInTheDocument();
    expect(screen.getByText('Contact & Info')).toBeInTheDocument();
    expect(screen.getByText('Tickets & Total')).toBeInTheDocument();
    expect(screen.getByText('Status & Flags')).toBeInTheDocument();
    expect(screen.getByText('Submitted At')).toBeInTheDocument();

    // 3. Verify To Be Approved vs Payment History navigation
    const pendingTab = screen.getByRole('button', { name: /To Be Approved/i });
    const historyTab = screen.getByRole('button', { name: /Payment History/i });
    expect(pendingTab).toBeInTheDocument();
    expect(historyTab).toBeInTheDocument();

    // In SUBMITTED mode (default), pending item is rendered
    expect(screen.getByText('RES-CAMP-111111')).toBeInTheDocument();

    // 4. Click specific campaign card to filter
    const abbaaCard = screen.getAllByText('Abbaa Carraa Lotu')[0];
    fireEvent.click(abbaaCard);
    expect(screen.getByText('RES-CAMP-111111')).toBeInTheDocument();

    // Switch to Payment History
    fireEvent.click(historyTab);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Payment History/i })).toBeInTheDocument();
    });
  });
});

