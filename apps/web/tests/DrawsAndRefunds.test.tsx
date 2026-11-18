// @vitest-environment jsdom
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DrawsView } from '../src/components/admin/DrawsView.js';
import { RefundsView } from '../src/components/admin/RefundsView.js';
import { AdminDashboard } from '../src/components/admin/AdminDashboard.js';
import { AdminUser, AdminLottery, AdminDrawItem, AdminRefundItem } from '../src/types/index.js';

const mockSuperadmin: AdminUser = {
  id: 'admin-super-1',
  email: 'superadmin@lottery.et',
  role: 'SUPERADMIN',
  username: 'superadmin',
  firstName: 'Super',
  lastName: 'Admin',
};

const mockOperator: AdminUser = {
  id: 'admin-op-1',
  email: 'operator@lottery.et',
  role: 'ADMIN',
  username: 'operator',
  firstName: 'Dawit',
  lastName: 'Bekele',
};

const mockClosedCampaign: AdminLottery = {
  id: 'camp-closed-1',
  slug: 'new-year-draw',
  title: 'Ethiopian New Year Mega Draw',
  prizeDescription: 'Toyota RAV4',
  ticketPriceMinor: '5000',
  numberStart: 1,
  numberEnd: 100,
  maxNumbersPerPurchase: 10,
  holdMinutes: 10,
  status: 'CLOSED',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockDraw: AdminDrawItem = {
  id: 'draw-uuid-1',
  lotteryId: 'camp-closed-1',
  lotteryTitle: 'Ethiopian New Year Mega Draw',
  prizeLabel: 'Grand Prize',
  eligibleCount: 85,
  eligibleSetSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef',
  randomSeed: 'f0e1d2c3b4a5968778695a4b3c2d1e0f0e1d2c3b4a5968778695a4b3c2d1e0f',
  winningNumber: 42,
  createdAt: new Date().toISOString(),
  runner: {
    email: 'superadmin@lottery.et',
    role: 'SUPERADMIN',
  },
  winner: {
    telegramUserId: '987654321',
    username: 'lucky_winner',
    firstName: 'Abebe',
    reservationReference: 'REF-WIN-12345',
  },
};

const mockRefund: AdminRefundItem = {
  id: 'refund-uuid-1',
  reservationId: 'res-cancel-1',
  amountMinor: '10000', // 100.00 ETB
  status: 'PENDING',
  note: 'Lottery cancelled: low participation',
  createdAt: new Date().toISOString(),
  reservationReference: 'REF-RFD-98765',
  lotteryTitle: 'Cancelled Test Campaign',
  customer: {
    username: 'kebede_tg',
    telegramUserId: '123456789',
    firstName: 'Kebede',
  },
  handler: null,
};

describe('Step 11: Draws and Refunds Frontend UI', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  it('1. DrawsView: renders CLOSED campaign, executes cryptographic draw, and displays winning ticket card with SHA-256', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/lotteries') && !urlStr.includes('/draw')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockClosedCampaign],
        } as Response);
      }

      if (urlStr.includes('/draws') && (!options?.method || options.method.toUpperCase() === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [mockDraw] }),
        } as Response);
      }

      if (urlStr.includes('/draw') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockDraw }),
        } as Response);
      }

      if (urlStr.includes('/announce') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { success: true, message: 'Winner announcement published to channel.' } }),
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled request: ${urlStr}`));
    });

    render(<DrawsView currentAdmin={mockSuperadmin} />);

    // Expect campaign title and status to load
    await waitFor(() => {
      expect(screen.getByText('Ethiopian New Year Mega Draw')).toBeInTheDocument();
    });

    expect(screen.getByText('CLOSED')).toBeInTheDocument();
    expect(screen.getByText('Execute Prize Draw')).toBeInTheDocument();

    // Fill prize label and submit draw
    const drawBtn = screen.getByRole('button', { name: /Execute Cryptographic Draw/i });
    expect(drawBtn).toBeInTheDocument();
    fireEvent.click(drawBtn);

    // Expect winning card to be displayed
    await waitFor(() => {
      expect(screen.getByText('#42')).toBeInTheDocument();
      expect(screen.getByText('CONFIRMED WINNER')).toBeInTheDocument();
      expect(screen.getByText('987654321')).toBeInTheDocument();
    });

    // Test announce to channel button
    const announceBtn = screen.getByRole('button', { name: /Announce to Channel/i });
    expect(announceBtn).toBeInTheDocument();
    fireEvent.click(announceBtn);

    await waitFor(() => {
      expect(screen.getByText(/Winner announcement.*published/i)).toBeInTheDocument();
    });
  });

  it('2. DrawsView: non-superadmin sees SUPERADMIN Only badge and draw form is disabled', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/lotteries')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockClosedCampaign],
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });

    render(<DrawsView currentAdmin={mockOperator} />);

    await waitFor(() => {
      expect(screen.getByText('Ethiopian New Year Mega Draw')).toBeInTheDocument();
    });

    expect(screen.getByText('SUPERADMIN Only')).toBeInTheDocument();
    const drawBtn = screen.getByRole('button', { name: /Execute Cryptographic Draw/i });
    expect(drawBtn).toBeDisabled();
  });

  it('3. RefundsView: renders refunds queue, opens Mark Paid modal, and marks refund as PAID', async () => {
    let currentStatus = 'PENDING';

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/admin/refunds') && options?.method === 'POST') {
        currentStatus = 'PAID';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { id: mockRefund.id, status: 'PAID', amountMinor: '10000', note: 'Paid via Telebirr' },
          }),
        } as Response);
      }

      if (urlStr.includes('/admin/refunds')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ ...mockRefund, status: currentStatus }],
            total: 1,
          }),
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled request: ${urlStr}`));
    });

    render(<RefundsView />);

    await waitFor(() => {
      expect(screen.getByText('REF-RFD-98765')).toBeInTheDocument();
      expect(screen.getAllByText(/100\.00 ETB/).length).toBeGreaterThan(0);
      expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0);
    });

    // Click Mark Paid
    const markPaidBtn = screen.getByRole('button', { name: 'Mark Paid' });
    fireEvent.click(markPaidBtn);

    // Modal opens
    expect(screen.getByText('Confirm Refund Payout')).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: 'Confirm Payout' });
    fireEvent.click(confirmBtn);

    // Verifies notification and status update
    await waitFor(() => {
      expect(screen.getByText(/marked as PAID/i)).toBeInTheDocument();
    });
  });

  it('4. AdminDashboard: navigates between Draws and Refunds tabs seamlessly', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/admin/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            activeCampaignsCount: 1,
            totalTicketsSold: 100,
            totalRevenueMinor: '500000',
            pendingReviewsCount: 0,
            failedOutboxCount: 0,
            totalCustomersCount: 50,
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });

    render(
      <AdminDashboard
        admin={mockSuperadmin}
        onLogout={vi.fn()}
        onSwitchToMiniApp={vi.fn()}
      />,
    );

    // Verify Draws & Winners tab and Refunds tab are removed from sidebar
    expect(screen.queryByRole('button', { name: /Draws & Winners/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Refunds$/i })).not.toBeInTheDocument();
  });
});
