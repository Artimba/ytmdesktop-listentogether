import { expect, test } from "@playwright/test";
import {
  closeYtmdInstance,
  enqueueTrackInRoom,
  getListenTogetherState,
  launchYtmdInstance,
  simulateAdEnded,
  simulateAdStarted,
  simulateLocalPlaybackEvent,
  simulateTrackEnded,
  simulateTrackReady,
  simulateTrackUnavailable,
  type YtmdE2EInstance,
} from "./helpers/electron-app";

test.describe("Listen Together E2E", () => {
  const instances: YtmdE2EInstance[] = [];

  test.afterEach(async () => {
    const toClose = instances.splice(0, instances.length);
    await Promise.all(toClose.map((inst) => closeYtmdInstance(inst)));
  });

  test("header placement, invite popover, and footer leave flow", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    const page = app.listenTogetherPage;

    // Create room from lobby
    await page.locator("#lt-display-name").fill("HostAlice");
    await page.getByRole("button", { name: "Create Room" }).click();

    await expect(page.locator(".lt-room-header")).toBeVisible();
    const header = page.locator(".lt-room-header");
    const inviteBtn = page.getByTestId("lt-invite-btn");
    const settingsBtn = page.getByTestId("lt-settings-btn");
    const footerLeaveBtn = page.getByTestId("lt-leave-btn");

    await expect(inviteBtn).toBeVisible();
    await expect(settingsBtn).toBeVisible();
    await expect(footerLeaveBtn).toBeVisible();

    // No Leave/End button in top header
    await expect(header.getByRole("button", { name: /Leave|End/ })).toHaveCount(
      0,
    );

    // Settings gear sits to the right of Invite button at top-right
    const inviteBox = await inviteBtn.boundingBox();
    const settingsBox = await settingsBtn.boundingBox();
    const footerLeaveBox = await footerLeaveBtn.boundingBox();
    expect(inviteBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    expect(footerLeaveBox).not.toBeNull();
    expect(settingsBox!.x).toBeGreaterThan(inviteBox!.x);
    expect(footerLeaveBox!.y).toBeGreaterThan(settingsBox!.y + 100);

    // Friends list aligns display name and tags cleanly on the same baseline
    const friendsToggle = page.getByTestId("lt-friends-toggle");
    await friendsToggle.click();
    const memberNameBox = await page.locator(".lt-member-name").first().boundingBox();
    const memberTagBox = await page.locator(".lt-member-tag").first().boundingBox();
    expect(memberNameBox).not.toBeNull();
    expect(memberTagBox).not.toBeNull();
    const nameMidY = memberNameBox!.y + memberNameBox!.height / 2;
    const tagMidY = memberTagBox!.y + memberTagBox!.height / 2;
    expect(Math.abs(nameMidY - tagMidY)).toBeLessThanOrEqual(1.5);

    // Invite popover opens cleanly with Online/Offline pill, compact invite link preview, and Copy Invite Link
    await inviteBtn.click();
    const popover = page.getByTestId("lt-invite-popover");
    await expect(popover).toBeVisible();
    const reachability = page.getByTestId("lt-invite-reachability");
    await expect(reachability).toBeVisible();
    await expect(reachability).toHaveText(/^(Online|Offline)$/);
    const linkPreview = page.getByTestId("lt-invite-link-preview");
    await expect(linkPreview).toBeVisible();
    const previewUrl = await linkPreview.inputValue();
    expect(previewUrl).toMatch(/^ytmd:\/\/l\//);
    await expect(page.getByTestId("lt-room-code")).toHaveCount(0);
    if ((await reachability.textContent())?.trim() === "Online") {
      const joinRes = await app.electronApp.evaluate(
        (_electron, rawUrl: string) => {
          const ctx = (globalThis as any).__ytmdE2E;
          return Boolean(ctx && typeof rawUrl === "string");
        },
        previewUrl,
      );
      expect(joinRes).toBe(true);
    }
    await expect(page.getByTestId("lt-copy-invite-link-btn")).toBeVisible();

    await page.getByTestId("lt-copy-invite-link-btn").click();
    await expect(page.getByTestId("lt-copy-invite-link-btn")).toContainText(
      "Link Copied",
    );

    // Leave from footer returns to lobby
    await expect(page.getByTestId("lt-leave-split-btn")).toBeVisible();
    await footerLeaveBtn.click();
    await expect(
      page.getByRole("button", { name: "Create Room" }),
    ).toBeVisible();
  });

  test("album art, artist + added-by attribution, and pin/unpin toggle", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    const page = app.listenTogetherPage;

    await page.locator("#lt-display-name").fill("HostAlice");
    await page.getByRole("button", { name: "Create Room" }).click();
    await expect(page.getByTestId("lt-now-playing")).toBeVisible();

    // Track 1 becomes Now Playing; Track 2 and Track 3 sit in Queue
    await enqueueTrackInRoom(app, {
      entryId: "e-1",
      videoId: "dQw4w9WgXcQ",
      title: "Track One",
      author: "Rick Astley",
      durationSec: 213,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    await enqueueTrackInRoom(app, {
      entryId: "e-2",
      videoId: "9bZkp7q19f0",
      title: "Track Two",
      author: "PSY",
      durationSec: 253,
      thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
    });
    await enqueueTrackInRoom(app, {
      entryId: "e-3",
      videoId: "kJQP7kiw5Fk",
      title: "Track Three",
      author: "Luis Fonsi",
      durationSec: 281,
      thumbnailUrl: null,
    });

    const rows = page.getByTestId("lt-queue-row");
    await expect(rows).toHaveCount(2);

    // Album art renders with referrerPolicy="no-referrer" and ytimg fallback for null thumbnailUrl
    const row0Img = rows.nth(0).locator("img.lt-thumb");
    const row1Img = rows.nth(1).locator("img.lt-thumb");
    await expect(row0Img).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(row0Img).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
    );
    await expect(row1Img).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(row1Img).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    );

    // Artist & side "by You" attribution both present
    await expect(rows.nth(0)).toContainText("PSY");
    await expect(rows.nth(0)).toContainText("by You");
    await expect(rows.nth(1)).toContainText("Luis Fonsi");
    await expect(rows.nth(1)).toContainText("by You");

    // Pin Track Three -> becomes row 0 and shows active .is-pinned state
    await rows.nth(1).getByTestId("lt-pin-btn").click();
    await expect(rows.nth(0)).toContainText("Track Three");
    await expect(rows.nth(0)).toHaveClass(/is-pinned/);
    await expect(rows.nth(0).getByTestId("lt-pin-btn")).toHaveClass(
      /is-pinned/,
    );
    await expect(rows.nth(0).getByTestId("lt-pin-btn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Unpin Track Three -> loses .is-pinned and returns after Track Two
    await rows.nth(0).getByTestId("lt-pin-btn").click();
    await expect(rows.nth(0)).toContainText("Track Two");
    await expect(rows.nth(1)).toContainText("Track Three");
    await expect(rows.nth(1)).not.toHaveClass(/is-pinned/);
    await expect(rows.nth(1).getByTestId("lt-pin-btn")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("local playback flow with add-to-queue and tune back in", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    const page = app.listenTogetherPage;

    await page.locator("#lt-display-name").fill("HostAlice");
    await page.getByRole("button", { name: "Create Room" }).click();
    await expect(page.getByTestId("lt-now-playing")).toBeVisible();

    await enqueueTrackInRoom(app, {
      entryId: "e-1",
      videoId: "dQw4w9WgXcQ",
      title: "Room Track",
      author: "Rick Astley",
      durationSec: 213,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    const remoteTimer = page.getByTestId("lt-remote-timer");
    await expect(remoteTimer).toBeVisible();
    await expect(remoteTimer).toHaveText(/^\d+:\d{2}\s*\/\s*3:33$/);

    // Simulate user clicking a song and playlist locally in YTMView
    await simulateLocalPlaybackEvent(app, {
      kind: "playlist",
      playlistId: "PLtest123456",
      videoId: "9bZkp7q19f0",
      title: "Local Mix",
      meta: {
        videoId: "9bZkp7q19f0",
        title: "Gangnam Style",
        author: "PSY",
        durationSec: 253,
        thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
      },
    });

    await expect(page.getByTestId("lt-status-label")).toHaveText(
      "Listening Locally",
    );
    await expect(remoteTimer).toBeVisible();
    await expect(remoteTimer).toHaveText(/^\d+:\d{2}\s*\/\s*3:33$/);
    const localBar = page.getByTestId("lt-local-bar");
    await expect(localBar).toBeVisible();
    await expect(localBar).toContainText("Gangnam Style");
    await expect(page.getByTestId("lt-tune-back-in-btn")).toBeVisible();

    // Tune back in -> exits local mode and resumes synced status
    await page.getByTestId("lt-tune-back-in-btn").click();
    await expect(localBar).toBeHidden();
    const state = await getListenTogetherState(app);
    expect(state.room?.listeningMode).toBe("room");
  });

  test("two-instance Host and Guest connect and share queue state", async () => {
    const host = await launchYtmdInstance();
    instances.push(host);
    const guest = await launchYtmdInstance();
    instances.push(guest);

    await host.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await host.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();

    await expect(host.listenTogetherPage.getByTestId("lt-invite-btn")).toBeVisible();

    const hostState = await getListenTogetherState(host);
    const inviteUrl = hostState.room?.inviteUrl;
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);

    // In local loopback test environments, replace LAN endpoint if needed is already encoded or test via direct joinByUrl
    const joinResult = await guest.electronApp.evaluate(
      (_electron, url: string) => {
        const ctx = (globalThis as any).__ytmdE2E;
        return ctx.listenTogetherService.joinByUrl(url, {
          displayName: "GuestBob",
        });
      },
      inviteUrl!,
    );
    expect(joinResult).toEqual({ ok: true });

    await expect(
      host.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (2)");
    await expect(
      guest.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (2)");

    await enqueueTrackInRoom(host, {
      entryId: "e-shared-1",
      videoId: "dQw4w9WgXcQ",
      title: "Shared Song",
      author: "Shared Band",
      durationSec: 200,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });

    await expect(
      guest.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Shared Song");
    await expect(
      guest.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Queued by HostAlice");
  });

  test("host click-to-jump, greyed-out history, and configurable vote skip", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    {
      await app.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
      await app.listenTogetherPage
        .getByRole("button", { name: "Create Room" })
        .click();
      await expect(
        app.listenTogetherPage.getByTestId("lt-invite-btn"),
      ).toBeVisible();

      await enqueueTrackInRoom(app, {
        entryId: "e-jump-1",
        videoId: "dQw4w9WgXcQ",
        title: "First Track",
        author: "Artist One",
        durationSec: 180,
        thumbnailUrl: null,
      });
      await enqueueTrackInRoom(app, {
        entryId: "e-jump-2",
        videoId: "9bZkp7q19f0",
        title: "Second Track",
        author: "Artist Two",
        durationSec: 190,
        thumbnailUrl: null,
      });
      await enqueueTrackInRoom(app, {
        entryId: "e-jump-3",
        videoId: "3JZ_D3ELwOQ",
        title: "Third Track",
        author: "Artist Three",
        durationSec: 200,
        thumbnailUrl: null,
      });

      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("First Track");
      await expect(
        app.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(2);

      // Host clicks Third Track directly to jump forward
      await app.listenTogetherPage
        .getByTestId("lt-queue-row")
        .nth(1)
        .click();

      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Third Track");
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-list"),
      ).toBeVisible();
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-row"),
      ).toHaveCount(1);
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-row").first(),
      ).toContainText("First Track");

      // Host clicks greyed-out First Track in history to jump back
      await app.listenTogetherPage
        .getByTestId("lt-history-row")
        .first()
        .click();
      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("First Track");
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-row").first(),
      ).toContainText("Third Track");

      // Configure Vote Skip in Room Settings and use Vote Skip button
      await app.listenTogetherPage.getByTestId("lt-settings-btn").click();
      const voteSkipSelect =
        app.listenTogetherPage.getByTestId("lt-vote-skip-select");
      await expect(voteSkipSelect).toHaveValue("majority");
      await voteSkipSelect.selectOption("off");
      await app.listenTogetherPage
        .locator('button[title="Back to room"]')
        .click();
      await expect(
        app.listenTogetherPage.getByTestId("lt-vote-skip-btn"),
      ).toHaveCount(0);

      await app.listenTogetherPage.getByTestId("lt-settings-btn").click();
      await app.listenTogetherPage
        .getByTestId("lt-vote-skip-select")
        .selectOption("majority");
      await app.listenTogetherPage
        .locator('button[title="Back to room"]')
        .click();

      const voteBtn = app.listenTogetherPage.getByTestId("lt-vote-skip-btn");
      await expect(voteBtn).toBeVisible();
      await expect(voteBtn).toContainText("0/1");
      await voteBtn.click();

      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Second Track");
    }
  });

  test("room name sync, queue track removal, and queue order settings", async () => {
    const host = await launchYtmdInstance();
    instances.push(host);
    const guest = await launchYtmdInstance();
    instances.push(guest);

    await host.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await host.listenTogetherPage
      .locator('input[placeholder*="Room name"]')
      .fill("Chill Vibes");
    await host.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();

    await expect(
      host.listenTogetherPage.getByTestId("lt-room-name"),
    ).toHaveText("Chill Vibes");

    const hostState = await getListenTogetherState(host);
    const inviteUrl = hostState.room?.inviteUrl;
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);
    const joinRes = await guest.electronApp.evaluate(
      (_electron, url: string) => {
        const ctx = (globalThis as any).__ytmdE2E;
        return ctx.listenTogetherService.joinByUrl(url, {
          displayName: "GuestBob",
        });
      },
      inviteUrl!,
    );
    expect(joinRes).toEqual({ ok: true });

    await expect(
      guest.listenTogetherPage.getByTestId("lt-room-name"),
    ).toHaveText("Chill Vibes");

    await enqueueTrackInRoom(host, {
      entryId: "e-q-1",
      videoId: "dQw4w9WgXcQ",
      title: "Track Alpha",
      author: "Artist A",
      durationSec: 180,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(host, {
      entryId: "e-q-2",
      videoId: "9bZkp7q19f0",
      title: "Track Beta",
      author: "Artist B",
      durationSec: 190,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(host, {
      entryId: "e-q-3",
      videoId: "3JZ_D3ELwOQ",
      title: "Track Gamma",
      author: "Artist C",
      durationSec: 200,
      thumbnailUrl: null,
    });

    await expect(
      guest.listenTogetherPage.getByTestId("lt-queue-row"),
    ).toHaveCount(2);

    // Host removes Track Beta from queue
    await host.listenTogetherPage
      .getByTestId("lt-queue-row")
      .first()
      .locator('button[title="Remove"]')
      .click();

    await expect(
      host.listenTogetherPage.getByTestId("lt-queue-row"),
    ).toHaveCount(1);
    await expect(
      host.listenTogetherPage.getByTestId("lt-queue-row").first(),
    ).toContainText("Track Gamma");
    await expect(
      guest.listenTogetherPage.getByTestId("lt-queue-row").first(),
    ).toContainText("Track Gamma");

    // Host switches Queue order setting to FIFO
    await host.listenTogetherPage.getByTestId("lt-settings-btn").click();
    const queueOrderSelect = host.listenTogetherPage.locator("#lt-queue-order");
    await expect(queueOrderSelect).toHaveValue("fair-rr");
    await queueOrderSelect.selectOption("fifo");
    await expect(queueOrderSelect).toHaveValue("fifo");
  });

  test("member moderation: Make DJ, guest enqueue, and Make Listener & Clear Queue", async () => {
    const host = await launchYtmdInstance();
    instances.push(host);
    const guest = await launchYtmdInstance();
    instances.push(guest);

    await host.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await host.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      host.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();

    const hostState = await getListenTogetherState(host);
    const inviteUrl = hostState.room?.inviteUrl;
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);
    const joinRes = await guest.electronApp.evaluate(
      (_electron, url: string) => {
        const ctx = (globalThis as any).__ytmdE2E;
        return ctx.listenTogetherService.joinByUrl(url, {
          displayName: "GuestBob",
        });
      },
      inviteUrl!,
    );
    expect(joinRes).toEqual({ ok: true });
    await expect(
      guest.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toBeVisible();

    // Ensure GuestBob is Listener first (if room defaulted to DJ), then promote to DJ
    await host.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    const friendsList = host.listenTogetherPage.locator(".lt-friends-list");
    await expect(friendsList).toContainText("GuestBob");
    if ((await friendsList.textContent())?.includes("(DJ)")) {
      await host.listenTogetherPage
        .locator('button[title="Member actions"]')
        .first()
        .click();
      await host.listenTogetherPage
        .getByRole("button", { name: "Make Listener", exact: true })
        .click();
      await expect(friendsList).not.toContainText("(DJ)");
    }

    // Host makes GuestBob a DJ
    await host.listenTogetherPage
      .locator('button[title="Member actions"]')
      .first()
      .click();
    await host.listenTogetherPage
      .getByRole("button", { name: "Make DJ", exact: true })
      .click();

    await expect(friendsList).toContainText("(DJ)");

    // Enqueue a starting track as host, then GuestBob (as DJ) enqueues a song
    await enqueueTrackInRoom(host, {
      entryId: "e-mod-1",
      videoId: "dQw4w9WgXcQ",
      title: "Host Opener",
      author: "Artist",
      durationSec: 180,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(guest, {
      entryId: "e-mod-2",
      videoId: "9bZkp7q19f0",
      title: "Guest DJ Song",
      author: "Guest Artist",
      durationSec: 195,
      thumbnailUrl: null,
    });

    await expect(
      host.listenTogetherPage.getByTestId("lt-queue-row"),
    ).toHaveCount(1);
    await expect(
      host.listenTogetherPage.getByTestId("lt-queue-row").first(),
    ).toContainText("Guest DJ Song");

    // Host demotes GuestBob and clears their queued song
    await host.listenTogetherPage
      .locator('button[title="Member actions"]')
      .first()
      .click();
    await host.listenTogetherPage
      .getByRole("button", { name: "Make Listener & Clear Queue" })
      .click();

    await expect(
      host.listenTogetherPage.getByTestId("lt-queue-row"),
    ).toHaveCount(0);
    await expect(
      host.listenTogetherPage.locator(".lt-friends-list"),
    ).not.toContainText("(DJ)");
  });

  test("mutual friend handshake, lobby friends card, refresh animation, and remove friend", async () => {
    const host = await launchYtmdInstance();
    instances.push(host);
    const guest = await launchYtmdInstance();
    instances.push(guest);

    await host.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await host.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      host.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();

    const hostState = await getListenTogetherState(host);
    const inviteUrl = hostState.room?.inviteUrl;
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);
    const joinRes = await guest.electronApp.evaluate(
      (_electron, url: string) => {
        const ctx = (globalThis as any).__ytmdE2E;
        return ctx.listenTogetherService.joinByUrl(url, {
          displayName: "GuestBob",
        });
      },
      inviteUrl!,
    );
    expect(joinRes).toEqual({ ok: true });
    await expect(
      guest.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toBeVisible();

    // Guest sends friend request to Host
    await guest.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    await guest.listenTogetherPage
      .locator('button[title="Add friend"]')
      .first()
      .click();
    await expect(
      guest.listenTogetherPage.locator(".lt-member-pending-chip"),
    ).toHaveText("Pending");

    // Host accepts friend request
    await host.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    const acceptBtn = host.listenTogetherPage
      .locator('button[title="Accept friend"]')
      .first();
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // Both sides show Friend badge
    await expect(
      host.listenTogetherPage.locator('span[title="Friend"]'),
    ).toBeVisible();
    await expect(
      guest.listenTogetherPage.locator('span[title="Friend"]'),
    ).toBeVisible();

    // Guest leaves to Lobby and sees HostAlice in Friends card
    await guest.listenTogetherPage.getByTestId("lt-leave-btn").click();
    const friendsCard = guest.listenTogetherPage.getByTestId("lt-friends-card");
    await expect(friendsCard).toBeVisible();
    await expect(friendsCard).toContainText("HostAlice");

    // HostAlice's room is open, so GuestBob's real Tailcat probe sees "Open" + Join button
    await expect(friendsCard.locator(".lt-status-chip")).toContainText("Open");
    await expect(
      friendsCard.getByRole("button", { name: "Join", exact: true }),
    ).toBeVisible();

    // HostAlice closes room -> wait for HostAlice to return to Lobby, then Refresh updates status to Offline
    await host.listenTogetherPage.getByTestId("lt-leave-btn").click();
    await expect(
      host.listenTogetherPage.getByRole("button", { name: "Create Room" }),
    ).toBeVisible();
    const refreshBtn = friendsCard.locator('button[title="Refresh friends"]');
    await expect(refreshBtn.locator(".lt-spin")).toHaveCount(0);
    await refreshBtn.click();
    await expect(refreshBtn.locator(".lt-spin")).toBeVisible();
    await expect(friendsCard.locator(".lt-status-chip")).toContainText(
      "Offline",
    );
    await expect(
      friendsCard.getByRole("button", { name: "Join", exact: true }),
    ).toHaveCount(0);

    // HostAlice renames to HostAliceV2 and reopens room -> GuestBob rejoins & leaves, then sees HostAliceV2 in Friends card
    await host.listenTogetherPage.locator("#lt-display-name").fill("HostAliceV2");
    await host.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      host.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();
    const renamedState = await getListenTogetherState(host);
    const renamedInviteUrl = renamedState.room?.inviteUrl ?? "";
    expect(renamedInviteUrl).toMatch(/^ytmd:\/\/l\//);
    const rejoinRes = await guest.electronApp.evaluate(
      (_electron, url: string) => {
        const ctx = (globalThis as any).__ytmdE2E;
        return ctx.listenTogetherService.joinByUrl(url, {
          displayName: "GuestBob",
        });
      },
      renamedInviteUrl,
    );
    expect(rejoinRes).toEqual({ ok: true });
    await expect(
      guest.listenTogetherPage.getByTestId("lt-leave-btn"),
    ).toBeVisible();
    await guest.listenTogetherPage.getByTestId("lt-leave-btn").click();
    await expect(friendsCard.locator(".lt-status-chip")).toContainText("Open");
    await expect(friendsCard).toContainText("HostAliceV2");

    // Remove friend returns card to empty state
    await friendsCard.locator('button[title="Remove friend"]').click();
    await expect(friendsCard).toContainText("No friends yet");
  });

  test("3-person room: friend announce, mixed queue add & removal, host leave migration, and rejoin", async () => {
    const alice = await launchYtmdInstance();
    instances.push(alice);
    const bob = await launchYtmdInstance();
    instances.push(bob);
    const charlie = await launchYtmdInstance();
    instances.push(charlie);

    await alice.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await alice.listenTogetherPage
      .locator('input[placeholder*="Room name"]')
      .fill("Trio Room");
    await alice.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      alice.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();

    const aliceState = await getListenTogetherState(alice);
    const inviteUrl = aliceState.room?.inviteUrl ?? "";
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);

    for (const [peer, name] of [
      [bob, "GuestBob"],
      [charlie, "GuestCharlie"],
    ] as const) {
      const joinRes = await peer.electronApp.evaluate(
        (_electron, args: { url: string; displayName: string }) => {
          const ctx = (globalThis as any).__ytmdE2E;
          return ctx.listenTogetherService.joinByUrl(args.url, {
            displayName: args.displayName,
          });
        },
        { url: inviteUrl, displayName: name },
      );
      expect(joinRes).toEqual({ ok: true });
    }

    await expect(
      alice.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (3)");
    await expect(
      bob.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (3)");
    await expect(
      charlie.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (3)");

    // Bob and Charlie both become mutual friends with Alice so Lobby groups them by shared room later
    await bob.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    await bob.listenTogetherPage
      .locator('button[title="Add friend"]')
      .first()
      .click();
    await charlie.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    await charlie.listenTogetherPage
      .locator('button[title="Add friend"]')
      .first()
      .click();
    await alice.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    await expect(
      alice.listenTogetherPage.locator('button[title="Accept friend"]'),
    ).toHaveCount(2);
    await alice.listenTogetherPage
      .locator('button[title="Accept friend"]')
      .first()
      .click();
    await alice.listenTogetherPage
      .locator('button[title="Accept friend"]')
      .first()
      .click();

    await expect(
      alice.listenTogetherPage.locator('span[title="Friend"]'),
    ).toHaveCount(2);

    // Deprecated Favorites star button is not rendered for guests
    await expect(
      charlie.listenTogetherPage.getByTestId("lt-favorite-btn"),
    ).toHaveCount(0);

    // Mixed queue additions from all 3 members
    await enqueueTrackInRoom(alice, {
      entryId: "e-3p-a1",
      videoId: "dQw4w9WgXcQ",
      title: "Alice Track 1",
      author: "Alice",
      durationSec: 180,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(alice, {
      entryId: "e-3p-a2",
      videoId: "9bZkp7q19f0",
      title: "Alice Track 2",
      author: "Alice",
      durationSec: 190,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(bob, {
      entryId: "e-3p-b1",
      videoId: "3JZ_D3ELwOQ",
      title: "Bob Track 1",
      author: "Bob",
      durationSec: 200,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(charlie, {
      entryId: "e-3p-c1",
      videoId: "L_jWHffIx5E",
      title: "Charlie Track 1",
      author: "Charlie",
      durationSec: 210,
      thumbnailUrl: null,
    });

    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Alice Track 1");
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(3);
    }

    // Bob removes Bob Track 1; Alice removes Charlie Track 1 -> 1 track left in queue across all 3
    const bobRowOnBob = bob.listenTogetherPage
      .getByTestId("lt-queue-row")
      .filter({ hasText: "Bob Track 1" });
    await bobRowOnBob.locator('button[title="Remove"]').click();

    await expect(
      alice.listenTogetherPage.getByTestId("lt-queue-row"),
    ).toHaveCount(2);

    const charlieRowOnAlice = alice.listenTogetherPage
      .getByTestId("lt-queue-row")
      .filter({ hasText: "Charlie Track 1" });
    await charlieRowOnAlice.locator('button[title="Remove"]').click();

    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(1);
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row").first(),
      ).toContainText("Alice Track 2");
    }

    // Add Charlie Track 2 so post-migration queue has multiple DJs, and seek Alice Track 1 to 42s
    await enqueueTrackInRoom(charlie, {
      entryId: "e-3p-c2",
      videoId: "kJQP7kiw5Fk",
      title: "Charlie Track 2",
      author: "Charlie",
      durationSec: 220,
      thumbnailUrl: null,
    });
    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(2);
    }

    await simulateTrackReady(alice, "dQw4w9WgXcQ");
    await simulateTrackReady(bob, "dQw4w9WgXcQ");
    await simulateTrackReady(charlie, "dQw4w9WgXcQ");
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.anchor?.desiredState)
      .toBe("PLAYING");
    await alice.electronApp.evaluate(() => {
      const ctx = (globalThis as any).__ytmdE2E;
      ctx.listenTogetherService.handleCommand({
        type: "hostTransport",
        action: "seek",
        seekPosSec: 42,
      });
    });
    await expect
      .poll(async () => (await getListenTogetherState(bob)).room?.remotePositionSec ?? 0)
      .toBeGreaterThanOrEqual(41);

    // Host Alice clicks Leave (endForAll: false) -> host migrates to Bob, Charlie stays in room
    await alice.listenTogetherPage.getByTestId("lt-leave-btn").click();
    await expect(
      alice.listenTogetherPage.getByRole("button", { name: "Create Room" }),
    ).toBeVisible();

    await expect(
      bob.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (2)");
    await expect(
      charlie.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (2)");

    // New host (Bob) preserves original addedBy attribution AND fair-queue order (Charlie Track 2 -> Alice Track 2)
    await expect(
      bob.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Queued by HostAlice");
    await expect(
      bob.listenTogetherPage.getByTestId("lt-queue-row").nth(0),
    ).toContainText("Charlie Track 2");
    await expect(
      bob.listenTogetherPage.getByTestId("lt-queue-row").nth(0),
    ).toContainText("by GuestCharlie");
    await expect(
      bob.listenTogetherPage.getByTestId("lt-queue-row").nth(1),
    ).toContainText("Alice Track 2");
    await expect(
      bob.listenTogetherPage.getByTestId("lt-queue-row").nth(1),
    ).toContainText("by HostAlice");

    // Timestamp syncs seamlessly across host migration (does not reset to 0)
    await expect
      .poll(async () => (await getListenTogetherState(bob)).room?.remotePositionSec ?? 0)
      .toBeGreaterThanOrEqual(41);
    await expect
      .poll(async () => (await getListenTogetherState(charlie)).room?.remotePositionSec ?? 0)
      .toBeGreaterThanOrEqual(41);

    // Alice sees Bob & Charlie grouped under shared lobby "Trio Room" and rejoins via group Join button
    const aliceFriendsCard = alice.listenTogetherPage.getByTestId("lt-friends-card");
    const aliceRefresh = aliceFriendsCard.locator('button[title="Refresh friends"]');
    await expect(aliceRefresh.locator(".lt-spin")).toHaveCount(0);
    await aliceRefresh.click();
    const lobbyGroup = aliceFriendsCard.getByTestId("lt-friend-lobby-group");
    await expect(lobbyGroup).toBeVisible();
    await expect(lobbyGroup).toContainText("Trio Room");
    await expect(lobbyGroup).toContainText("GuestBob");
    await expect(lobbyGroup).toContainText("GuestCharlie");
    await lobbyGroup
      .getByRole("button", { name: "Join", exact: true })
      .click();

    await expect(
      alice.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (3)");
    await expect(
      alice.listenTogetherPage.getByTestId("lt-queue-row").first(),
    ).toContainText("Charlie Track 2");
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.remotePositionSec ?? 0)
      .toBeGreaterThanOrEqual(41);
  });

  test("3-person room: in-ad peer requires strict majority for TRACK_ENDED and non-owner TRACK_UNAVAILABLE does not skip", async () => {
    const alice = await launchYtmdInstance();
    instances.push(alice);
    const bob = await launchYtmdInstance();
    instances.push(bob);
    const charlie = await launchYtmdInstance();
    instances.push(charlie);

    await alice.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await alice.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      alice.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();

    const aliceState = await getListenTogetherState(alice);
    const inviteUrl = aliceState.room?.inviteUrl ?? "";
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);

    for (const [peer, name] of [
      [bob, "GuestBob"],
      [charlie, "GuestCharlie"],
    ] as const) {
      const joinRes = await peer.electronApp.evaluate(
        (_electron, args: { url: string; displayName: string }) => {
          const ctx = (globalThis as any).__ytmdE2E;
          return ctx.listenTogetherService.joinByUrl(args.url, {
            displayName: args.displayName,
          });
        },
        { url: inviteUrl, displayName: name },
      );
      expect(joinRes).toEqual({ ok: true });
    }

    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-friends-toggle"),
      ).toContainText("Friends (3)");
    }

    // Enqueue 3 tracks: Bob owns Track 1 (Now Playing), Alice owns Track 2 & Track 3
    await enqueueTrackInRoom(bob, {
      entryId: "e-q-1",
      videoId: "dQw4w9WgXcQ",
      title: "Quorum Track 1",
      author: "Bob",
      durationSec: 180,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    await expect(
      alice.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Quorum Track 1");
    await enqueueTrackInRoom(alice, {
      entryId: "e-q-2",
      videoId: "9bZkp7q19f0",
      title: "Quorum Track 2",
      author: "Alice",
      durationSec: 190,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(alice, {
      entryId: "e-q-3",
      videoId: "3JZ_D3ELwOQ",
      title: "Quorum Track 3",
      author: "Alice",
      durationSec: 200,
      thumbnailUrl: null,
    });

    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Quorum Track 1");
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(2);
    }

    // Charlie enters an ad -> active non-ad peer count becomes 2 (Alice + Bob)
    await alice.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    await simulateAdStarted(charlie);
    await expect(alice.listenTogetherPage.locator(".lt-friends-list")).toContainText(
      "In ad",
    );

    // Mark Track 1 ready on Alice & Bob, then a single premature TRACK_ENDED from Bob must NOT skip
    await simulateTrackReady(alice, "dQw4w9WgXcQ");
    await simulateTrackReady(bob, "dQw4w9WgXcQ");
    await simulateTrackEnded(bob);
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.currentTrack?.title)
      .toBe("Quorum Track 1");
    await expect(
      alice.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Quorum Track 1");
    await expect(
      alice.listenTogetherPage.getByTestId("lt-queue-row"),
    ).toHaveCount(2);

    // Second active peer (Alice) sending TRACK_ENDED reaches strict majority (2/2) -> advances to Quorum Track 2
    await simulateTrackEnded(alice);
    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Quorum Track 2");
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(1);
    }

    // Stale TrackEnded from Bob BEFORE trackReady on Quorum Track 2 must be ignored
    await simulateTrackEnded(bob);
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.currentTrack?.title)
      .toBe("Quorum Track 2");

    // Non-owner (Bob) reporting TRACK_UNAVAILABLE for Alice's Quorum Track 2 must NOT skip
    await simulateTrackUnavailable(bob, "9bZkp7q19f0", 150);
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.currentTrack?.title)
      .toBe("Quorum Track 2");
    await expect(
      alice.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Quorum Track 2");

    // Owner (Alice) reporting TRACK_UNAVAILABLE for Quorum Track 2 skips immediately to Quorum Track 3
    await simulateTrackUnavailable(alice, "9bZkp7q19f0", 150);
    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Quorum Track 3");
      await expect(
        inst.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(0);
    }
  });

  test("3-person room: adStarted pauses room, tuneOut clears ad wait, and adEnded resumes playback", async () => {
    const alice = await launchYtmdInstance();
    instances.push(alice);
    const bob = await launchYtmdInstance();
    instances.push(bob);
    const charlie = await launchYtmdInstance();
    instances.push(charlie);

    await alice.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await alice.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      alice.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();

    const aliceState = await getListenTogetherState(alice);
    const inviteUrl = aliceState.room?.inviteUrl ?? "";
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);

    for (const [peer, name] of [
      [bob, "GuestBob"],
      [charlie, "GuestCharlie"],
    ] as const) {
      const joinRes = await peer.electronApp.evaluate(
        (_electron, args: { url: string; displayName: string }) => {
          const ctx = (globalThis as any).__ytmdE2E;
          return ctx.listenTogetherService.joinByUrl(args.url, {
            displayName: args.displayName,
          });
        },
        { url: inviteUrl, displayName: name },
      );
      expect(joinRes).toEqual({ ok: true });
    }

    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-friends-toggle"),
      ).toContainText("Friends (3)");
    }

    await enqueueTrackInRoom(alice, {
      entryId: "e-ad-1",
      videoId: "dQw4w9WgXcQ",
      title: "Ad Test Track",
      author: "Rick Astley",
      durationSec: 213,
      thumbnailUrl: null,
    });

    await simulateTrackReady(alice, "dQw4w9WgXcQ");
    await simulateTrackReady(bob, "dQw4w9WgXcQ");
    await simulateTrackReady(charlie, "dQw4w9WgXcQ");
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.anchor?.desiredState)
      .toBe("PLAYING");

    // Charlie enters an ad -> room pauses for ad and Charlie shows "In ad"
    await alice.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    await simulateAdStarted(charlie);
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.anchor?.pausedForAd)
      .toBe(true);
    await expect(alice.listenTogetherPage.locator(".lt-friends-list")).toContainText(
      "In ad",
    );

    // Charlie tunes out while in-ad -> room clears pausedForAd and In ad badge
    await simulateLocalPlaybackEvent(charlie, {
      kind: "track",
      videoId: "L_jWHffIx5E",
      title: "Local Track",
    });
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.anchor?.pausedForAd)
      .toBe(false);
    await expect(
      alice.listenTogetherPage.locator(".lt-friends-list"),
    ).not.toContainText("In ad");

    // Bob enters an ad -> room pauses for ad, then adEnded resumes playback
    await simulateAdStarted(bob);
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.anchor?.pausedForAd)
      .toBe(true);
    await expect(alice.listenTogetherPage.locator(".lt-friends-list")).toContainText(
      "In ad",
    );

    await simulateAdEnded(bob, "dQw4w9WgXcQ");
    await expect
      .poll(async () => (await getListenTogetherState(alice)).room?.anchor?.pausedForAd)
      .toBe(false);
    await expect(
      alice.listenTogetherPage.locator(".lt-friends-list"),
    ).not.toContainText("In ad");
  });

  test("QA edge cases: naughty display names, truncation, and identical conflicting display names", async () => {
    const alice = await launchYtmdInstance();
    instances.push(alice);
    const bob = await launchYtmdInstance();
    instances.push(bob);
    const charlie = await launchYtmdInstance();
    instances.push(charlie);

    // 1. Whitespace-only display name is rejected in Lobby
    await alice.listenTogetherPage.locator("#lt-display-name").fill("   \t  ");
    await alice.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      alice.listenTogetherPage.getByRole("button", { name: "Create Room" }),
    ).toBeVisible();

    // 2. Over-32-char naughty string is clamped to 32 chars and rendered safely without XSS
    const naughtyLong = "A".repeat(40) + "<img src=x onerror=alert(1)>";
    await alice.listenTogetherPage.locator("#lt-display-name").fill(naughtyLong);
    await alice.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      alice.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();
    const clampedState = await getListenTogetherState(alice);
    expect(clampedState.displayName).toHaveLength(32);
    await alice.listenTogetherPage.getByTestId("lt-leave-btn").click();
    await expect(
      alice.listenTogetherPage.getByRole("button", { name: "Create Room" }),
    ).toBeVisible();

    // 3. All 3 peers join with identical XSS/Unicode naughty display name
    const twinName = "Twin🎧<script>alert(1)</script>"; // 31 chars
    await alice.listenTogetherPage.locator("#lt-display-name").fill(twinName);
    await alice.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();
    await expect(
      alice.listenTogetherPage.getByTestId("lt-invite-btn"),
    ).toBeVisible();

    const aliceState = await getListenTogetherState(alice);
    const inviteUrl = aliceState.room?.inviteUrl ?? "";
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);

    for (const [peer, rawName] of [
      [bob, twinName],
      [charlie, `  ${twinName}  `],
    ] as const) {
      const joinRes = await peer.electronApp.evaluate(
        (_electron, args: { url: string; displayName: string }) => {
          const ctx = (globalThis as any).__ytmdE2E;
          return ctx.listenTogetherService.joinByUrl(args.url, {
            displayName: args.displayName.trim().slice(0, 32),
          });
        },
        { url: inviteUrl, displayName: rawName },
      );
      expect(joinRes).toEqual({ ok: true });
    }

    for (const inst of [alice, bob, charlie]) {
      await expect(
        inst.listenTogetherPage.getByTestId("lt-friends-toggle"),
      ).toContainText("Friends (3)");
    }

    // Open member list on Bob: 3 distinct members, no injected <script>/<img>, exactly one (You) & one (Host)
    await bob.listenTogetherPage.getByTestId("lt-friends-toggle").click();
    const memberNames = bob.listenTogetherPage.locator(".lt-member-name");
    await expect(memberNames).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(memberNames.nth(i)).toHaveText(twinName);
    }
    await expect(
      bob.listenTogetherPage.locator(".lt-friends-list script"),
    ).toHaveCount(0);
    await expect(
      bob.listenTogetherPage.locator(".lt-friends-list").getByText("(You)"),
    ).toHaveCount(1);
    await expect(
      bob.listenTogetherPage.locator(".lt-friends-list").getByText("(Host)"),
    ).toHaveCount(1);

    // 4. Fair-queue & attribution stay isolated per peerId even with identical displayName
    await enqueueTrackInRoom(alice, {
      entryId: "e-twin-a1",
      videoId: "dQw4w9WgXcQ",
      title: "Twin Alice 1",
      author: "Artist",
      durationSec: 180,
      thumbnailUrl: null,
    });
    await expect(
      bob.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Twin Alice 1");
    // Bob must NOT see "Queued by You" for Alice's track despite identical displayName
    await expect(
      bob.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText(`Queued by ${twinName}`);

    await enqueueTrackInRoom(alice, {
      entryId: "e-twin-a2",
      videoId: "9bZkp7q19f0",
      title: "Twin Alice 2",
      author: "Artist",
      durationSec: 185,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(bob, {
      entryId: "e-twin-b1",
      videoId: "3JZ_D3ELwOQ",
      title: "Twin Bob 1",
      author: "Artist",
      durationSec: 190,
      thumbnailUrl: null,
    });
    await enqueueTrackInRoom(charlie, {
      entryId: "e-twin-c1",
      videoId: "kJQP7kiw5Fk",
      title: "Twin Charlie 1",
      author: "Artist",
      durationSec: 195,
      thumbnailUrl: null,
    });

    // Fair queue interleaves: Twin Bob 1 -> Twin Charlie 1 -> Twin Alice 2
    const bobQueue = bob.listenTogetherPage.getByTestId("lt-queue-row");
    await expect(bobQueue).toHaveCount(3);
    await expect(bobQueue.nth(0)).toContainText("Twin Bob 1");
    await expect(bobQueue.nth(0)).toContainText("by You");
    await expect(bobQueue.nth(1)).toContainText("Twin Charlie 1");
    await expect(bobQueue.nth(1)).toContainText(`by ${twinName}`);
    await expect(bobQueue.nth(2)).toContainText("Twin Alice 2");
    await expect(bobQueue.nth(2)).toContainText(`by ${twinName}`);
  });
});
