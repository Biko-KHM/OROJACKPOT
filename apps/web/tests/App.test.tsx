// @vitest-environment jsdom
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../src/App.js';
import { CampaignSummary } from '../src/types/index.js';
import { clearClientCache } from '../src/api/client.js';

const mockCampaign: CampaignSummary = {
  id: 'camp-123',
  slug: 'new-year-2026',
  title: 'Ethiopian New Year Grand Draw',
  description: 'Annual national lottery with massive prizes',
  prizeDescription: 'Toyota Land Cruiser V8',
  ticketPriceMinor: '25000', // 250.00 ETB
  numberStart: 0,
  numberEnd: 1999, // 2,000 numbers
  maxNumbersPerPurchase: 20,
  holdMinutes: 10,
  status: 'OPEN',
  totalNumbers: 2000,
  reservedNumbers: 150,
  availableNumbers: 1850,
};

describe('Step 9: Telegram Lottery Mini App Frontend', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    clearClientCache();

    // Default mock fetch for open campaigns and numbers summary
    global.fetch = vi.fn().mockImplementation((url: string, _options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/lotteries/camp-123/numbers-summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            lotteryId: 'camp-123',
            totalNumbers: 2000,
            counts: { available: 2000, held: 0, pendingReview: 0, reserved: 0 },
            ranges: [{ start: 0, end: 1999, status: 'AVAILABLE' }],
            cachedAt: new Date().toISOString(),
          }),
        } as Response);
      }

      if (urlStr.includes('/lotteries')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockCampaign],
        } as Response);
      }

      if (urlStr.includes('/auth/telegram')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            token: 'mock-jwt-token',
            user: {
              id: 'user-1',
              telegramUserId: '987654321',
              firstName: 'Abebe',
              username: 'abebe123',
              role: 'CUSTOMER',
            },
          }),
        } as Response);
      }

      if (urlStr.includes('/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'user-1',
            telegramUserId: '987654321',
            firstName: 'Abebe',
            username: 'abebe123',
            role: 'CUSTOMER',
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });
  });

  it('1. Renders active campaigns and supports trilingual language toggle (English <-> Afaan Oromoo <-> Amharic)', async () => {
    render(<App />);

    // Click "Continue to Mini App" from welcome screen if present
    const continueBtn = screen.queryByText('Continue to Mini App');
    if (continueBtn) fireEvent.click(continueBtn);

    // Verify campaign is loaded and displayed
    await waitFor(() => {
      expect(screen.getByText('Ethiopian New Year Grand Draw')).toBeInTheDocument();
      expect(screen.getAllByText('Toyota Land Cruiser V8').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/250.00/)).toBeInTheDocument();
    });

    // Select Language Afaan Oromoo
    const omBtn = screen.getByRole('button', { name: /Select Afaan Oromoo/i });
    fireEvent.click(omBtn);

    // Verify header and campaign card text changed to Afaan Oromoo
    await waitFor(() => {
      expect(screen.getByText('OROJACKPOT Lootorii')).toBeInTheDocument();
      expect(screen.getByText('Lootoriiwwan Hojii Irra Jiran')).toBeInTheDocument();
      expect(screen.getByText('Lakkoofsa Filadhu')).toBeInTheDocument();
    });

    // Select Language Amharic
    const amBtn = screen.getByRole('button', { name: /Select Amharic/i });
    fireEvent.click(amBtn);
    await waitFor(() => {
      expect(screen.getByText('OROJACKPOT ሎተሪ')).toBeInTheDocument();
      expect(screen.getByText('ንቁ ሎተሪዎች')).toBeInTheDocument();
      expect(screen.getByText('እድለኛ ቁጥሮችን ይምረጡ')).toBeInTheDocument();
    });

    // Select back to English
    const enBtn = screen.getByRole('button', { name: /Select English/i });
    fireEvent.click(enBtn);
    await waitFor(() => {
      expect(screen.getByText('OROJACKPOT')).toBeInTheDocument();
    });
  });

  it('2. Navigates to virtualized 2,000 Number Grid and selects numbers', async () => {
    render(<App />);

    const continueBtn = screen.queryByText('Continue to Mini App');
    if (continueBtn) fireEvent.click(continueBtn);

    const campaignCard = (await screen.findAllByText('Ethiopian New Year Grand Draw'))[0];
    fireEvent.click(campaignCard);

    // Verify Number Grid top bar & legend loaded
    await waitFor(() => {
      expect(screen.getByText(/Status/i)).toBeInTheDocument();
      expect(screen.getByText('Available')).toBeInTheDocument();
      expect(screen.getByText('Held')).toBeInTheDocument();
      expect(screen.getByText('Sold')).toBeInTheDocument();
    });

    // Select an available number (e.g. 5)
    const num5Btn = await screen.findByRole('button', { name: /Number 5,/i });
    expect(num5Btn).toBeInTheDocument();
    fireEvent.click(num5Btn);

    // Verify bottom checkout tray appears with 1 ticket selected
    await waitFor(() => {
      expect(screen.getByText(/1 of 20 selected/i)).toBeInTheDocument();
      expect(screen.getByText(/Hold Selected Tickets/i)).toBeInTheDocument();
    });
  });

  it('3. Acceptance Criteria: a 409 at checkout shows a clear message and refreshes the grid', async () => {
    render(<App />);

    const continueBtn = screen.queryByText('Continue to Mini App');
    if (continueBtn) fireEvent.click(continueBtn);

    const campaignCard = (await screen.findAllByText('Ethiopian New Year Grand Draw'))[0];
    fireEvent.click(campaignCard);

    // Pick number 6
    const num6Btn = await screen.findByRole('button', { name: /Number 6,/i });
    fireEvent.click(num6Btn);

    const holdBtn = await screen.findByText(/Hold Selected Tickets/i);

    // Mock API returning 409 CONFLICT (another buyer just took number 6)
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/reservations') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: async () => ({
            error: {
              code: 'NUMBER_UNAVAILABLE',
              message: 'Number 6 is already held by another user.',
            },
          }),
        } as Response);
      }

      if (urlStr.includes('/numbers-summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            lotteryId: 'camp-123',
            totalNumbers: 2000,
            counts: { available: 1999, held: 1, pendingReview: 0, reserved: 0 },
            ranges: [
              { start: 0, end: 5, status: 'AVAILABLE' },
              { start: 6, end: 6, status: 'HELD' },
              { start: 7, end: 1999, status: 'AVAILABLE' },
            ],
            cachedAt: new Date().toISOString(),
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    // User clicks checkout
    fireEvent.click(holdBtn);

    // Verify 409 conflict banner appears with clear instruction
    await waitFor(() => {
      expect(screen.getByText(/Tickets Taken/i)).toBeInTheDocument();
      expect(
        screen.getByText(/One or more of your chosen numbers was just taken by another player/i),
      ).toBeInTheDocument();
    });
  });

  it('4. Successfully holds tickets and displays countdown and payment instructions', async () => {
    render(<App />);

    const continueBtn = screen.queryByText('Continue to Mini App');
    if (continueBtn) fireEvent.click(continueBtn);

    const campaignCard = (await screen.findAllByText('Ethiopian New Year Grand Draw'))[0];
    fireEvent.click(campaignCard);

    // Pick number 7
    const num7Btn = await screen.findByRole('button', { name: /Number 7,/i });
    fireEvent.click(num7Btn);

    const holdBtn = await screen.findByText(/Hold Selected Tickets/i);

    // Mock successful reservation creation
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/reservations') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: 'res-abc-123',
            publicReference: 'RES-ETHIO-987654',
            lotteryId: 'camp-123',
            status: 'AWAITING_PAYMENT',
            currency: 'ETB',
            unitPriceMinor: '25000',
            ticketCount: 1,
            totalAmountMinor: '25000',
            holdExpiresAt: new Date(Date.now() + 600 * 1000).toISOString(),
            items: [
              {
                id: 'item-1',
                numberValueSnapshot: 7,
                unitPriceMinor: '25000',
              },
            ],
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    fireEvent.click(holdBtn);

    // Verify hold screen displays payment accounts and structured inputs without RES code or contact badges
    await waitFor(() => {
      expect(screen.queryByText('RES-ETHIO-987654')).not.toBeInTheDocument();
      expect(screen.getByText(/Commercial Bank of Ethiopia/i)).toBeInTheDocument();
      expect(screen.getByText(/Telebirr SuperApp/i)).toBeInTheDocument();
      expect(screen.getByText(/Upload Payment Receipt/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/e\.g\. Abebe Kebede/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/e\.g\. 0912 345 678/i)).toBeInTheDocument();
      expect(screen.queryByText(/Your Payment Reference/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/FT26291ABC10/i)).not.toBeInTheDocument();
    });
  });

  it('5. Navigates to My Tickets tab, fetches /me/tickets, and renders confirmed tickets with lucky numbers', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, _options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/me/tickets')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'res-conf-1',
              publicReference: 'TKT-ETHIO-123456',
              lotteryId: 'camp-123',
              status: 'CONFIRMED',
              currency: 'ETB',
              unitPriceMinor: '25000',
              ticketCount: 2,
              totalAmountMinor: '50000',
              submittedAt: new Date().toISOString(),
              lottery: {
                id: 'camp-123',
                title: 'Ethiopian New Year Grand Draw',
                slug: 'new-year-2026',
                prizeDescription: 'Toyota Land Cruiser V8',
              },
              items: [
                { id: 'item-1', numberValueSnapshot: 42, unitPriceMinor: '25000' },
                { id: 'item-2', numberValueSnapshot: 77, unitPriceMinor: '25000' },
              ],
            },
          ],
        } as Response);
      }

      if (urlStr.includes('/auth/telegram')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            token: 'mock-jwt-token',
            user: {
              id: 'user-1',
              telegramUserId: '987654321',
              firstName: 'Abebe',
              username: 'abebe123',
              role: 'CUSTOMER',
            },
          }),
        } as Response);
      }

      if (urlStr.includes('/lotteries')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockCampaign],
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    render(<App />);

    const continueBtn = screen.queryByText('Continue to Mini App');
    if (continueBtn) fireEvent.click(continueBtn);

    // Wait for main screen to mount after demo auth
    await screen.findAllByText('Ethiopian New Year Grand Draw');

    // Click My Tickets
    const ticketsNavBtns = screen.getAllByRole('button', { name: 'My Tickets' });
    fireEvent.click(ticketsNavBtns[0]);

    // Verify tickets load and render
    await waitFor(() => {
      expect(screen.getByText(/TKT-ETHIO-123456/i)).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('77')).toBeInTheDocument();
      expect(screen.getAllByText('Toyota Land Cruiser V8').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/CONFIRMED/i)).toBeInTheDocument();
    });
  });

  it('6. Draft campaigns: renders as "COMING SOON" on user side and opens preview modal without routing to number grid', async () => {
    const mockDraftCampaign: CampaignSummary = {
      id: 'camp-draft-999',
      slug: 'easter-special-2026',
      title: 'Easter Mega Special',
      prizeDescription: 'Electric Hyundai Ioniq 5',
      ticketPriceMinor: '50000',
      numberStart: 0,
      numberEnd: 999,
      maxNumbersPerPurchase: 10,
      holdMinutes: 10,
      status: 'DRAFT',
      totalNumbers: 1000,
      reservedNumbers: 0,
      availableNumbers: 1000,
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/auth/telegram')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            token: 'mock-jwt-token',
            user: {
              id: 'user-1',
              telegramUserId: '987654321',
              firstName: 'Abebe',
              username: 'abebe123',
              role: 'CUSTOMER',
            },
          }),
        } as Response);
      }
      if (urlStr.includes('/lotteries')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockDraftCampaign],
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    render(<App />);

    const continueBtn = screen.queryByText('Continue to Mini App');
    if (continueBtn) fireEvent.click(continueBtn);

    // Verify Coming Soon badge and title
    await waitFor(() => {
      expect(screen.getByText('COMING SOON')).toBeInTheDocument();
      expect(screen.getByText('Electric Hyundai Ioniq 5')).toBeInTheDocument();
      expect(screen.getByText('Easter Mega Special')).toBeInTheDocument();
    });

    // Clicking Coming Soon card opens the preview dialog
    const comingSoonBtn = screen.getByRole('button', { name: /Coming Soon/i });
    fireEvent.click(comingSoonBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Coming Soon!')).toBeInTheDocument();
      expect(screen.getByText(/Ticket sales have not opened yet for this lottery/i)).toBeInTheDocument();
      expect(screen.getByText('Got It')).toBeInTheDocument();
    });

    // Clicking Got It closes the modal
    fireEvent.click(screen.getByText('Got It'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
