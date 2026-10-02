document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const appPages = new Set([
    'dashboard.html',
    'cartoons.html',
    'collection.html',
    'team.html',
    'my.html',
    'profile.html',
    'deposit.html',
    'withdrawals.html',
    'rewards.html',
    'plans.html',
    'salaries.html',
    'fortune.html'
  ]);

  const API_BASE = (() => {
    if (window.XPLODE_API_BASE) return String(window.XPLODE_API_BASE).replace(/\/+$/, '');
    const isLocalPreview = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
    if (window.location.protocol === 'file:' || isLocalPreview) {
      return 'http://localhost:3000';
    }
    return window.location.origin;
  })();

  const defaultState = {
    user: {
      username: '',
      fullName: '',
      email: '',
      mobile: '',
      invite_code: ''
    },
    wallet: {
      withdrawable: 0,
      total: 0,
      pending: 0
    },
    rewards: {
      points: 0,
      tier: 'New',
      boost: 0
    },
    fortune: {
      streak: 0,
      score: 0,
      next: 'No verified result'
    }
  };

  function readState() {
    try {
      const raw = localStorage.getItem('xpAppState');
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(defaultState),
        ...parsed,
        user: { ...defaultState.user, ...(parsed.user || {}) },
        wallet: { ...defaultState.wallet, ...(parsed.wallet || {}) }
      };
    } catch (error) {
      return structuredClone(defaultState);
    }
  }

  function writeState(state) {
    localStorage.setItem('xpAppState', JSON.stringify(state));
  }

  const appState = readState();

  async function apiRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('xpToken') ? { Authorization: `Bearer ${localStorage.getItem('xpToken')}` } : {}),
          ...(options.headers || {})
        }
      });
    } catch (error) {
      throw new Error('The XPLODE API is not running. XAMPP serves the page, but this app also needs the Node backend: open the project folder in a terminal and run "npm install" once, then "npm run dev". Use http://localhost:3000 or keep this XAMPP page open after the backend starts.');
    }

    if (response.status === 401 && currentPage !== 'index.html' && currentPage !== 'register.html') {
      clearSession();
      window.location.replace('index.html');
      throw new Error('Your session expired. Please sign in again.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Request failed');
    }
    return payload;
  }

  function clearSession() {
    localStorage.removeItem('xpLogin');
    localStorage.removeItem('xpToken');
    localStorage.removeItem('xpAppState');
  }

  function redirectToLogin() {
    window.location.replace('index.html');
  }

  const isAuthPage = ['index.html', 'register.html'].includes(currentPage);

  if (!isAuthPage && !appPages.has(currentPage)) {
    redirectToLogin();
    return;
  }

  // Gate on a locally present token for an instant first paint; verified below against the server.
  if (!isAuthPage && !localStorage.getItem('xpToken')) {
    redirectToLogin();
    return;
  }

  if (currentPage === 'index.html' && localStorage.getItem('xpToken')) {
    window.location.replace('dashboard.html');
    return;
  }

  const currency = (value) => `UGX ${Number(value).toLocaleString()}`;

  function setPageMessage(message, type = 'error') {
    const messageBox = document.getElementById('formMessage') || document.getElementById('registerMessage') || document.getElementById('depositMessage') || document.getElementById('withdrawMessage') || document.getElementById('rewardMessage') || document.getElementById('pageMessage');
    if (!messageBox) {
      const box = document.createElement('p');
      box.id = 'pageMessage';
      box.className = 'form-message';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const target = document.getElementById('pageMessage') || document.getElementById('formMessage') || document.getElementById('registerMessage') || document.getElementById('depositMessage') || document.getElementById('withdrawMessage') || document.getElementById('rewardMessage');
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('success', type === 'success');
    target.classList.toggle('error', type !== 'success');
  }

  async function refreshWallet() {
    if (isAuthPage) return;
    try {
      const result = await apiRequest('/api/wallet');
      if (result.wallet) {
        appState.wallet = {
          withdrawable: Number(result.wallet.withdrawable) || 0,
          total: Number(result.wallet.total) || 0,
          pending: Number(result.wallet.pending) || 0
        };
        writeState(appState);
        updateBalanceDisplays();
      }
    } catch (error) {
      // Session problems are handled inside apiRequest; keep the cached balance otherwise.
    }
  }

  function updateBalanceDisplays() {
    const balanceNodes = document.querySelectorAll('.balance-box strong');
    balanceNodes.forEach((node) => {
      node.textContent = currency(appState.wallet.withdrawable);
    });

    const totalBalanceEls = document.querySelectorAll('[data-balance="total"]');
    totalBalanceEls.forEach((node) => {
      node.textContent = currency(appState.wallet.total);
    });

    const withdrawableEls = document.querySelectorAll('[data-balance="withdrawable"]');
    withdrawableEls.forEach((node) => {
      node.textContent = currency(appState.wallet.withdrawable);
    });

    const pendingEls = document.querySelectorAll('[data-balance="pending"]');
    pendingEls.forEach((node) => {
      node.textContent = currency(appState.wallet.pending);
    });
  }

  function updateProfileDisplays() {
    const heading = document.getElementById('profileHeading');
    if (heading && !heading.dataset.staticHeading) {
      heading.textContent = appState.user.fullName;
    }

    const username = document.getElementById('profileUsername');
    if (username) username.textContent = appState.user.username ? `@${appState.user.username}` : '';

    const avatar = document.getElementById('accountAvatar');
    if (avatar) {
      avatar.textContent = appState.user.fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('') || 'XP';
    }

    const inviteCode = String(appState.user.invite_code || '');
    document.querySelectorAll('#profileInviteCode, #teamInviteCode').forEach((node) => {
      node.textContent = inviteCode;
    });

    const inviteLink = document.getElementById('teamInviteLink');
    if (inviteLink) {
      const url = new URL('register.html', window.location.href);
      url.searchParams.set('ref', inviteCode);
      inviteLink.textContent = url.toString();
    }
  }

  async  function copyAccountValue(value, button, successText = 'Copied') {
    if (!value) {
      setPageMessage('Sign in again to load your invitation code.', 'error');
      return;
    }
    const originalText = button.textContent;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = successText;
      setTimeout(() => { button.textContent = originalText; }, 1400);
    } catch (error) {
      setPageMessage('Clipboard access was not granted. Select and copy the invitation value.', 'error');
    }
  }

  function updateRewardDisplays() {
    const pointsEls = document.querySelectorAll('[data-reward="points"]');
    pointsEls.forEach((node) => {
      node.textContent = Number(appState.rewards.points).toLocaleString();
    });

    const tierEls = document.querySelectorAll('[data-reward="tier"]');
    tierEls.forEach((node) => {
      node.textContent = appState.rewards.tier;
    });

    const boostEls = document.querySelectorAll('[data-reward="boost"]');
    boostEls.forEach((node) => {
      node.textContent = `+${appState.rewards.boost}%`;
    });
  }

  function updateFortuneDisplays() {
    const streakEls = document.querySelectorAll('[data-fortune="streak"]');
    streakEls.forEach((node) => {
      node.textContent = `${appState.fortune.streak} Days`;
    });

    const scoreEls = document.querySelectorAll('[data-fortune="score"]');
    scoreEls.forEach((node) => {
      node.textContent = Number(appState.fortune.score).toFixed(1);
    });

    const nextEls = document.querySelectorAll('[data-fortune="next"]');
    nextEls.forEach((node) => {
      node.textContent = appState.fortune.next;
    });
  }

  function syncAppData() {
    updateBalanceDisplays();
    updateProfileDisplays();
    updateRewardDisplays();
    updateFortuneDisplays();
  }

  document.querySelectorAll('.nav-item').forEach((link) => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  document.querySelectorAll('[data-logout]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      clearSession();
      window.location.href = 'index.html';
    });
  });

  document.querySelectorAll('.bottom-link').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
    }
  });

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const message = document.getElementById('formMessage');
    const submitButton = loginForm.querySelector('[type="submit"]');

    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();

      if (!username || !password) {
        message.textContent = 'Please enter both your username and password.';
        message.classList.remove('success');
        return;
      }

      if (submitButton) submitButton.disabled = true;
      apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
        .then((result) => {
          const nextState = {
            ...structuredClone(defaultState),
            user: { ...defaultState.user, ...result.user, fullName: result.user.full_name || result.user.username },
            wallet: { ...defaultState.wallet, ...(result.wallet || {}) }
          };
          writeState(nextState);
          localStorage.setItem('xpToken', result.token);
          localStorage.setItem('xpLogin', result.user.username);
          if (result.role === 'admin') {
            // Hand the admin token to the dashboard page so it opens straight away.
            sessionStorage.setItem('xpAdminToken', result.token);
          }
          message.textContent = result.message || 'Login successful. Welcome back!';
          message.classList.add('success');
          setTimeout(() => {
            window.location.href = result.role === 'admin' ? 'admin.html' : 'dashboard.html';
          }, 300);
        })
        .catch((error) => {
          message.textContent = error.message || 'Incorrect username or password.';
          message.classList.remove('success');
        })
        .finally(() => {
          if (submitButton) submitButton.disabled = false;
        });
    });
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    const message = document.getElementById('registerMessage');
    const inviteField = document.getElementById('inviteCode');
    const referralFromUrl = new URLSearchParams(window.location.search).get('ref');
    if (inviteField && referralFromUrl && !inviteField.value) inviteField.value = referralFromUrl;
    const submitButton = registerForm.querySelector('[type="submit"]');

    registerForm.addEventListener('submit', (event) => {
      event.preventDefault();

      const username = document.getElementById('regUsername').value.trim();
      const email = document.getElementById('email').value.trim();
      const mobile = document.getElementById('mobile').value.trim();
      const inviteCode = document.getElementById('inviteCode').value.trim();
      const regPassword = document.getElementById('regPassword').value.trim();
      const confirmPassword = document.getElementById('confirmPassword').value.trim();
      const pin = document.getElementById('pin').value.trim();

      if (!username || !email || !mobile || !regPassword || !confirmPassword || !pin) {
        message.textContent = 'Please complete all fields.';
        message.classList.remove('success');
        return;
      }

      if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
        message.textContent = 'Username must be 3-24 letters, numbers, or underscores.';
        message.classList.remove('success');
        return;
      }

      if (regPassword.length < 8) {
        message.textContent = 'Your password must be at least 8 characters.';
        message.classList.remove('success');
        return;
      }

      if (regPassword !== confirmPassword) {
        message.textContent = 'Your passwords do not match.';
        message.classList.remove('success');
        return;
      }

      if (!/^[0-9]{5}$/.test(pin)) {
        message.textContent = 'Your withdrawal PIN must be exactly 5 digits.';
        message.classList.remove('success');
        return;
      }

      if (submitButton) submitButton.disabled = true;
      apiRequest('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          email,
          mobile,
          inviteCode,
          password: regPassword,
          pin
        })
      })
        .then((result) => {
          const nextState = {
            ...structuredClone(defaultState),
            user: {
              ...defaultState.user,
              ...result.user,
              username,
              fullName: result.user.full_name || username,
              email,
              mobile,
              invite_code: result.user.invite_code || ''
            },
            wallet: { ...defaultState.wallet, ...(result.wallet || {}) }
          };
          writeState(nextState);
          localStorage.setItem('xpToken', result.token);
          localStorage.setItem('xpLogin', username);
          message.textContent = result.message || 'Account created successfully. Welcome to XPLODE!';
          message.classList.add('success');
          setTimeout(() => {
            window.location.href = 'dashboard.html';
          }, 700);
        })
        .catch((error) => {
          message.textContent = error.message || 'Unable to create account.';
          message.classList.remove('success');
        })
        .finally(() => {
          if (submitButton) submitButton.disabled = false;
        });
    });
  }

  document.querySelectorAll('.toggle-password').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target') || 'password';
      const target = document.getElementById(targetId);
      if (!target) return;
      const isPassword = target.type === 'password';
      target.type = isPassword ? 'text' : 'password';
      button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  });

  // Verified session boot: sync fresh profile + wallet data from the server.
  if (!isAuthPage) {
    apiRequest('/api/me')
      .then((result) => {
        if (result.user) {
          appState.user = {
            ...appState.user,
            ...result.user,
            fullName: result.user.full_name || result.user.username
          };
        }
        if (result.wallet) {
          appState.wallet = {
            withdrawable: Number(result.wallet.withdrawable) || 0,
            total: Number(result.wallet.total) || 0,
            pending: Number(result.wallet.pending) || 0
          };
        }
        writeState(appState);
        syncAppData();
      })
      .catch((error) => {
        // Network failure keeps the cached UI; 401 already redirected to login.
      });
  }

  const gallery = document.querySelector('.gallery-grid');
  if (gallery) {
    const filterButtons = document.querySelectorAll('.filter');
    const cards = Array.from(gallery.querySelectorAll('.gallery-card'));

    const applyFilter = (category) => {
      cards.forEach((card) => {
        const match = category === 'all' || card.dataset.category === category;
        card.style.display = match ? '' : 'none';
      });
    };

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        filterButtons.forEach((item) => item.classList.toggle('active', item === button));
        const value = button.textContent.trim().toLowerCase();
        applyFilter(value === 'all' ? 'all' : value);
      });
    });
  }

  // Shared "Congratulations" popup — same 3D candy panel family as the fortune modal.
  const showRewardPopup = ({ title = 'Congratulations!', amount = '', note = '', emoji = '🎉' } = {}) =>
    new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'reward-overlay';

      const modal = document.createElement('section');
      modal.className = 'reward-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'rewardPopupTitle');

      const badge = document.createElement('div');
      badge.className = 'reward-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = emoji;

      const heading = document.createElement('h2');
      heading.id = 'rewardPopupTitle';
      heading.textContent = title;

      modal.append(badge, heading);

      if (amount) {
        const amountPill = document.createElement('strong');
        amountPill.className = 'reward-amount';
        amountPill.textContent = amount;
        modal.append(amountPill);
      }

      if (note) {
        const noteP = document.createElement('p');
        noteP.className = 'reward-note';
        noteP.textContent = note;
        modal.append(noteP);
      }

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'reward-close';
      closeButton.textContent = 'Awesome! 🎉';
      modal.append(closeButton);
      overlay.append(modal);

      let closed = false;
      const closePopup = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('is-open');
        modal.classList.add('is-leaving');
        window.setTimeout(() => overlay.remove(), 170);
        resolve();
      };
      const onKey = (event) => {
        if (event.key === 'Escape') closePopup();
      };

      closeButton.addEventListener('click', closePopup);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePopup();
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      window.requestAnimationFrame(() => overlay.classList.add('is-open'));
    });

  const watchList = document.getElementById('watchList');
  if (watchList) {
    const watchCards = Array.from(watchList.querySelectorAll('.watch-card'));
    let activeWatchIndex = 0;

    const showWatchCard = (index) => {
      if (!watchCards.length) return;
      activeWatchIndex = (index + watchCards.length) % watchCards.length;
      watchCards[activeWatchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    document.getElementById('watchPrevious')?.addEventListener('click', () => showWatchCard(activeWatchIndex - 1));
    document.getElementById('watchNext')?.addEventListener('click', () => showWatchCard(activeWatchIndex + 1));
  }

  const toonhubList = document.getElementById('watchList');
  if (toonhubList) {
    const note = document.getElementById('watchAccessNote');
    const toonCards = Array.from(toonhubList.querySelectorAll('[data-watch-level]'));
    const watchTimers = new Map();

    const claimReward = async (card, level, button) => {
      button.disabled = true;
      try {
        const result = await apiRequest('/api/toonhub/claim', {
          method: 'POST',
          body: JSON.stringify({ level })
        });
        if (result.wallet) {
          appState.wallet = {
            withdrawable: Number(result.wallet.withdrawable) || 0,
            total: Number(result.wallet.total) || 0,
            pending: Number(result.wallet.pending) || 0
          };
          writeState(appState);
          updateBalanceDisplays();
        }
        if (note) note.textContent = result.message;
        await loadToonhubStatus();
        await showRewardPopup({
          title: 'Congratulations!',
          amount: `+ UGX ${Number(result.amount).toLocaleString()}`,
          note: 'Your daily reward has been added to your withdrawable balance.'
        });
      } catch (error) {
        if (note) note.textContent = error.message || 'Unable to claim today’s reward.';
        button.disabled = false;
      }
    };

    const startSixSecondTimer = (card, level, button) => {
      window.clearInterval(watchTimers.get(level));
      let remaining = 6;
      button.disabled = true;
      button.textContent = `Stream · ${remaining}s remaining`;
      const timer = window.setInterval(async () => {
        remaining -= 1;
        if (remaining > 0) {
          button.textContent = `Stream · ${remaining}s remaining`;
          return;
        }
        window.clearInterval(timer);
        watchTimers.delete(level);
        try {
          await apiRequest('/api/toonhub/complete', {
            method: 'POST',
            body: JSON.stringify({ level })
          });
          button.disabled = false;
          button.textContent = 'Claim';
          if (note) note.textContent = 'Your reward is ready to claim.';
          await loadToonhubStatus();
        } catch (error) {
          button.disabled = false;
          button.textContent = 'Stream';
          if (note) note.textContent = error.message || 'Keep the video open and try again.';
        }
      }, 1000);
      watchTimers.set(level, timer);
    };

    const loadToonhubStatus = async () => {
      const result = await apiRequest('/api/toonhub/status');
      const levels = new Map((result.levels || []).map((level) => [Number(level.level), level]));
      const activeLevel = (result.levels || []).find((level) => level.active === true)?.level || null;
      toonCards.forEach((card) => {
        const level = Number(card.dataset.watchLevel);
        const status = levels.get(level);
        if (!status) return;
        const active = status.active === true;
        const subscribeButton = card.querySelector('[data-subscribe-level]');
        const watchButton = card.querySelector('[data-watch-start]');
        const claimButton = card.querySelector('[data-watch-claim]');
        const depositLink = card.querySelector('.watch-deposit-link');
        const video = card.querySelector('iframe[data-video-src]');
        const lockOverlay = card.querySelector('.watch-lock-overlay');
        const watchStartedHere = video?.dataset.started === 'true';

        card.classList.toggle('is-locked', !active);
        if (lockOverlay) {
          lockOverlay.hidden = active && watchStartedHere;
          lockOverlay.textContent = !active
            ? activeLevel && activeLevel !== level
              ? `Locked · your VIP ${activeLevel} subscription is active`
              : `Subscribe to VIP ${level} to watch`
            : status.watchedToday
              ? 'You have already watched this level today'
              : `Select Watch VIP ${level} to start today's video`;
        }
        if (subscribeButton) subscribeButton.hidden = active;
        if (subscribeButton) {
          subscribeButton.disabled = status.paymentPending;
          subscribeButton.textContent = status.paymentPending ? 'Subscription requested' : `Subscribe VIP ${level}`;
        }
        if (depositLink) depositLink.hidden = !status.paymentPending;
        if (watchButton) {
          watchButton.hidden = !active;
          watchButton.disabled = status.claimedToday || Boolean(watchTimers.get(level));
          watchButton.textContent = status.claimedToday
            ? 'Unlock · available tomorrow'
            : status.watchedToday
              ? 'Claim'
              : status.startedToday
                ? 'Stream'
                : 'Stream';
        }
        if (claimButton) {
          claimButton.hidden = true;
        }
      });
    };

    toonCards.forEach((card) => {
      const level = Number(card.dataset.watchLevel);
      card.querySelector('[data-subscribe-level]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const result = await apiRequest('/api/toonhub/subscribe', {
            method: 'POST',
            body: JSON.stringify({ level })
          });
          if (note) note.textContent = result.message;
          await loadToonhubStatus();
        } catch (error) {
          if (note) note.textContent = error.message || 'Unable to request this level.';
          button.disabled = false;
        }
      });

      card.querySelector('[data-watch-start]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        if (button.textContent === 'Claim') {
          await claimReward(card, level, button);
          return;
        }
        if (button.disabled) return;
        button.disabled = true;
        try {
          const result = await apiRequest('/api/toonhub/watch', {
            method: 'POST',
            body: JSON.stringify({ level })
          });
          const video = card.querySelector('iframe[data-video-src]');
          if (video) {
            video.dataset.started = 'true';
            video.src = video.dataset.videoSrc;
            initializeWatchPlayer(card, level);
          }
          if (note) note.textContent = result.message;
          startSixSecondTimer(card, level, button);
        } catch (error) {
          if (note) note.textContent = error.message || 'Unable to start today’s video.';
          button.disabled = false;
        }
      });

      card.querySelector('[data-watch-claim]')?.addEventListener('click', (event) => {
        claimReward(card, level, event.currentTarget);
      });
    });

    const initializeWatchPlayer = (card, level) => {
      const video = card.querySelector('iframe[data-video-src]');
      if (!video || !window.YT?.Player || video.dataset.playerInitialized === 'true') return;
      video.dataset.playerInitialized = 'true';
      new window.YT.Player(video, {
        events: {
          onStateChange: async (event) => {
            if (event.data !== window.YT.PlayerState.ENDED || video.dataset.completionRequested === 'true') return;
            video.dataset.completionRequested = 'true';
            try {
              const result = await apiRequest('/api/toonhub/complete', {
                method: 'POST',
                body: JSON.stringify({ level })
              });
              if (note) note.textContent = result.message;
              await loadToonhubStatus();
            } catch (error) {
              video.dataset.completionRequested = 'false';
              if (note) note.textContent = error.message || 'Unable to verify video completion.';
            }
          }
        }
      });
    };

    const previousYoutubeReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousYoutubeReady?.();
      toonCards.forEach((card) => {
        if (card.querySelector('iframe[data-video-src]')?.dataset.started === 'true') {
          initializeWatchPlayer(card, Number(card.dataset.watchLevel));
        }
      });
    };
    const youtubeApi = document.createElement('script');
    youtubeApi.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(youtubeApi);

    loadToonhubStatus().catch((error) => {
      if (note) note.textContent = error.message || 'Unable to load Toonhub access.';
    });
  }

  const profileHeading = document.getElementById('profileHeading');
  const editProfileButton = document.getElementById('editProfileBtn');
  if (profileHeading && editProfileButton) {
    let editing = false;
    let currentHeading = profileHeading;

    const saveProfileName = async (input) => {
      const nextName = input.value.trim();
      if (nextName.length < 2 || nextName.length > 80) {
        setPageMessage('Name must be between 2 and 80 characters.', 'error');
        return;
      }

      editProfileButton.disabled = true;
      try {
        const result = await apiRequest('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ fullName: nextName })
        });
        appState.user.fullName = result.user.full_name;
        writeState(appState);
        currentHeading = document.createElement('h1');
        currentHeading.id = 'profileHeading';
        currentHeading.textContent = result.user.full_name;
        input.replaceWith(currentHeading);
        editing = false;
        editProfileButton.textContent = 'Edit profile';
        setPageMessage(result.message, 'success');
      } catch (error) {
        setPageMessage(error.message || 'Unable to update profile.', 'error');
      } finally {
        editProfileButton.disabled = false;
      }
    };

    editProfileButton.addEventListener('click', () => {
      if (!editing) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = appState.user.fullName;
        input.maxLength = 80;
        input.className = 'profile-name-input';
        input.style.width = '220px';
        input.style.padding = '10px 12px';
        input.style.borderRadius = '12px';
        input.style.border = '1px solid rgba(40, 48, 54, 0.14)';
        input.style.outline = 'none';
        currentHeading.replaceWith(input);
        editing = true;
        editProfileButton.textContent = 'Save';
        input.focus();
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            saveProfileName(input);
          } else if (event.key === 'Escape') {
            input.replaceWith(currentHeading);
            editing = false;
            editProfileButton.textContent = 'Edit profile';
          }
        });
        return;
      }

      const currentInput = document.querySelector('.profile-name-input');
      if (currentInput) {
        saveProfileName(currentInput);
      }
    });
  }

  const copyProfileInviteButton = document.getElementById('copyProfileInvite');
  if (copyProfileInviteButton) {
    copyProfileInviteButton.addEventListener('click', () => {
      copyAccountValue(document.getElementById('profileInviteCode')?.textContent, copyProfileInviteButton, '✓');
    });
  }

  const copyTeamInviteCodeButton = document.getElementById('copyTeamInviteCode');
  if (copyTeamInviteCodeButton) {
    copyTeamInviteCodeButton.addEventListener('click', () => {
      copyAccountValue(document.getElementById('teamInviteCode')?.textContent, copyTeamInviteCodeButton);
    });
  }

  const copyTeamInviteLinkButton = document.getElementById('copyTeamInviteLink');
  if (copyTeamInviteLinkButton) {
    copyTeamInviteLinkButton.addEventListener('click', () => {
      copyAccountValue(document.getElementById('teamInviteLink')?.textContent, copyTeamInviteLinkButton);
    });
  }

  const shareTeamInviteButton = document.getElementById('shareTeamInvite');
  if (shareTeamInviteButton) {
    shareTeamInviteButton.addEventListener('click', async () => {
      const inviteLink = document.getElementById('teamInviteLink')?.textContent;
      if (!inviteLink) return;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Join XPLODE', text: 'Use my invitation link to register.', url: inviteLink });
        } catch (error) {
          if (error.name !== 'AbortError') setPageMessage('Unable to share the invitation link.', 'error');
        }
      } else {
        await copyAccountValue(inviteLink, shareTeamInviteButton, 'Link copied');
      }
    });
  }

  const depositForm = document.getElementById('depositForm');
  if (depositForm) {
    const copyButtons = Array.from(depositForm.querySelectorAll('.deposit-copy-number[data-copy-target]'));
    const providerInput = document.getElementById('depositMethod');
    const paymentPanels = {
      'Airtel Money': document.getElementById('airtelPaymentDetails'),
      'MTN Mobile Money': document.getElementById('mtnPaymentDetails')
    };
    const depositHistory = document.getElementById('depositHistory');
    const submitButton = depositForm.querySelector('[type="submit"]');

    const updatePaymentDetails = () => {
      Object.entries(paymentPanels).forEach(([provider, panel]) => {
        if (panel) panel.hidden = providerInput.value !== provider;
      });
    };

    providerInput.addEventListener('change', updatePaymentDetails);
    updatePaymentDetails();

    const renderHistoryList = (listElement, entries, build) => {
      listElement.replaceChildren();
      if (!entries.length) {
        const emptyItem = document.createElement('li');
        const emptyText = document.createElement('div');
        const emptyHeading = document.createElement('strong');
        emptyHeading.textContent = 'Nothing submitted yet';
        emptyText.appendChild(emptyHeading);
        emptyItem.appendChild(emptyText);
        listElement.appendChild(emptyItem);
        return;
      }
      entries.forEach((entry) => listElement.appendChild(build(entry)));
    };

    const parseTimestamp = (value) => {
      const parsed = new Date(`${String(value).replace(' ', 'T')}Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

  const renderHistoryError = (listElement, message, retryLoader) => {
    listElement.replaceChildren();
    const item = document.createElement('li');
    const messageNode = document.createElement('div');
    messageNode.textContent = message || 'Unable to load this history right now.';
    item.appendChild(messageNode);
    if (retryLoader) {
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'history-retry';
      retryButton.textContent = 'Try again';
      retryButton.addEventListener('click', () => {
        retryButton.disabled = true;
        retryButton.textContent = 'Retrying…';
        retryLoader().finally(() => {});
      });
      item.appendChild(retryButton);
    }
    listElement.appendChild(item);
  };

  const loadDepositHistory = async () => {
      if (!depositHistory) return;
      try {
        const result = await apiRequest('/api/deposits');
        renderHistoryList(depositHistory, result.deposits || [], (deposit) => {
          const item = document.createElement('li');
          const icon = document.createElement('span');
          const details = document.createElement('div');
          const heading = document.createElement('strong');
          const subtext = document.createElement('small');
          const amount = document.createElement('b');
          const createdAt = parseTimestamp(deposit.created_at);
          icon.className = 'history-icon incoming';
          icon.textContent = '↗';
          heading.textContent = currency(deposit.amount);
          subtext.textContent = `${deposit.provider} · ${deposit.status} · ${createdAt ? createdAt.toLocaleDateString() : ''}`;
          amount.textContent = deposit.status;
          details.append(heading, subtext);
          item.append(icon, details, amount);
          return item;
        });
      } catch (error) {
        renderHistoryError(depositHistory, error.message, loadDepositHistory);
      }
    };

    loadDepositHistory();

    copyButtons.forEach((copyButton) => {
      const numberElement = document.getElementById(copyButton.getAttribute('data-copy-target'));
      if (!numberElement) return;
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(numberElement.textContent.trim());
          copyButton.textContent = 'Copied';
          copyButton.classList.add('is-copied');
        } catch (error) {
          copyButton.textContent = 'Copy failed';
        }
        setTimeout(() => {
          copyButton.textContent = 'Copy number';
          copyButton.classList.remove('is-copied');
        }, 1200);
      });
    });

    depositForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!depositForm.reportValidity()) return;
      const amountInput = document.getElementById('depositAmount');
      const transactionIdInput = document.getElementById('depositTransactionId');
      const payerNumberInput = document.getElementById('depositPayerNumber');
      const amount = Number(amountInput.value);
      const provider = providerInput.value;
      const transactionId = transactionIdInput.value.trim();
      const payerNumber = payerNumberInput ? payerNumberInput.value.trim() : '';
      if (!Number.isSafeInteger(amount) || amount < 10000) {
        setPageMessage('Minimum deposit is UGX 10,000.', 'error');
        return;
      }

      if (payerNumberInput && !/^0\d{9}$/.test(payerNumber)) {
        setPageMessage('Enter the mobile money number you paid from, e.g. 0788734485.', 'error');
        return;
      }

      if (submitButton) submitButton.disabled = true;
      apiRequest('/api/wallet/deposit', {
        method: 'POST',
        body: JSON.stringify({ amount, provider, transactionId, payerNumber })
      })
        .then((result) => {
          depositForm.reset();
          updatePaymentDetails();
          setPageMessage(result.message, 'success');
          loadDepositHistory();
        })
        .catch((error) => {
          setPageMessage(error.message || 'Unable to process this deposit.', 'error');
        })
        .finally(() => {
          if (submitButton) submitButton.disabled = false;
        });
    });

    depositForm.addEventListener('reset', updatePaymentDetails);
  }

  const withdrawForm = document.getElementById('withdrawForm');
  if (withdrawForm) {
    const accountSelect = document.getElementById('withdrawSelect');
    const accountNameInput = document.getElementById('withdrawAccountName');
    const accountNumberInput = document.getElementById('withdrawAccountNumber');
    const withdrawalHistory = document.getElementById('withdrawalHistory');
    const cooldownNotice = document.getElementById('withdrawCooldown');
    const submitButton = withdrawForm.querySelector('[type="submit"]');

    const renderCooldown = (nextWithdrawalAt) => {
      if (!cooldownNotice) return;
      if (!nextWithdrawalAt) {
        cooldownNotice.hidden = true;
        return;
      }
      const nextTime = new Date(nextWithdrawalAt);
      if (Number.isNaN(nextTime.getTime())) {
        cooldownNotice.hidden = true;
        return;
      }
      const hoursLeft = Math.max(1, Math.ceil((nextTime.getTime() - Date.now()) / (60 * 60 * 1000)));
      cooldownNotice.hidden = false;
      cooldownNotice.querySelector('span:last-child').textContent =
        `One withdrawal per 24 hours. Next request allowed in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} (${nextTime.toLocaleString()})`;
      if (submitButton) submitButton.disabled = true;
    };

    const loadWithdrawalHistory = async () => {
      if (!withdrawalHistory) return;
      try {
        const result = await apiRequest('/api/withdrawals');
        document.querySelectorAll('[data-balance="withdrawable"]').forEach((node) => {
          node.textContent = currency(result.available);
        });
        document.querySelectorAll('[data-balance="pending"]').forEach((node) => {
          node.textContent = currency(result.pending);
        });

        renderCooldown(result.nextWithdrawalAt);

        withdrawalHistory.replaceChildren();
        if (!result.withdrawals.length) {
          const emptyItem = document.createElement('li');
          const emptyText = document.createElement('div');
          const emptyHeading = document.createElement('strong');
          emptyHeading.textContent = 'No withdrawals submitted yet';
          emptyText.appendChild(emptyHeading);
          emptyItem.appendChild(emptyText);
          withdrawalHistory.appendChild(emptyItem);
          return;
        }

        result.withdrawals.forEach((withdrawal) => {
          const item = document.createElement('li');
          const icon = document.createElement('span');
          const details = document.createElement('div');
          const heading = document.createElement('strong');
          const subtext = document.createElement('small');
          const status = document.createElement('b');
          const createdAt = new Date(`${String(withdrawal.created_at).replace(' ', 'T')}Z`);
          icon.className = 'history-icon outgoing';
          icon.textContent = '↘';
          heading.textContent = currency(withdrawal.amount);
          const destination = withdrawal.account_number
            ? `${withdrawal.account_provider} · ${withdrawal.account_number} · `
            : '';
          subtext.textContent = `${destination}${withdrawal.status} · ${Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleDateString()}`;
          status.textContent = withdrawal.status;
          details.append(heading, subtext);
          item.append(icon, details, status);
          withdrawalHistory.appendChild(item);
        });
      } catch (error) {
        renderHistoryError(withdrawalHistory, error.message, loadWithdrawalHistory);
      }
    };

    loadWithdrawalHistory();

    withdrawForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!withdrawForm.reportValidity()) return;
      const amountInput = document.getElementById('withdrawAmount');
      const pinInput = document.getElementById('withdrawPin');
      const amount = Number(amountInput.value);
      const pin = pinInput.value.trim();
      const accountProvider = accountSelect?.value || '';
      const accountName = accountNameInput?.value.trim() || '';
      const accountNumber = accountNumberInput?.value.trim() || '';

      if (!['mtn', 'airtel'].includes(accountProvider)) {
        setPageMessage('Choose MTN Mobile Money or Airtel Money.', 'error');
        return;
      }

      if (accountName.length < 3) {
        setPageMessage('Enter the account holder name.', 'error');
        return;
      }

      if (!/^0\d{9}$/.test(accountNumber)) {
        setPageMessage('Enter a valid mobile money number, e.g. 0770123456.', 'error');
        return;
      }

      if (!Number.isSafeInteger(amount) || amount < 500) {
        setPageMessage('Minimum withdrawal is UGX 500.', 'error');
        return;
      }

      if (submitButton) submitButton.disabled = true;
      apiRequest('/api/wallet/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          pin,
          accountProvider: accountProvider === 'mtn' ? 'MTN Mobile Money' : 'Airtel Money',
          accountName,
          accountNumber
        })
      })
        .then((result) => {
          withdrawForm.reset();
          setPageMessage(result.message, 'success');
          refreshWallet();
          loadWithdrawalHistory();
        })
        .catch((error) => {
          setPageMessage(error.message || 'Unable to process this withdrawal.', 'error');
        })
        .finally(() => {
          if (submitButton) submitButton.disabled = false;
        });
    });
  }

  const fortuneOverlay = document.getElementById('fortuneOverlay');
  const fortuneOpenButton = document.getElementById('openFortuneButton');
  const fortuneCloseButton = document.getElementById('closeFortuneButton');
  const fortuneCodeForm = document.getElementById('fortuneCodeForm');
  const fortuneCodeInput = document.getElementById('fortuneCodeInput');
  const fortuneResult = document.getElementById('fortuneResult');
  const fortuneEnvelope = document.querySelector('.fortune-envelope');
  const fortuneModalTitle = document.getElementById('fortuneModalTitle');
  const fortuneModalDescription = document.getElementById('fortuneModalDescription');
  const fortuneWinButton = document.getElementById('fortuneWinButton');
  const fortuneTotal = document.querySelector('[data-fortune-total]');
  const fortuneWinsList = document.getElementById('fortuneWinsList');
  const fortuneEmptyState = document.getElementById('fortuneEmptyState');

  const renderFortuneWins = (wins) => {
    if (!fortuneWinsList || !fortuneEmptyState) return;
    fortuneWinsList.replaceChildren();
    fortuneEmptyState.hidden = wins.length > 0;

    wins.forEach((win) => {
      const item = document.createElement('article');
      item.className = 'fortune-win-item';

      const icon = document.createElement('span');
      icon.className = 'fortune-win-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '💎';

      const details = document.createElement('div');
      details.className = 'fortune-win-details';

      const code = document.createElement('strong');
      code.textContent = win.code;

      const redeemedAt = new Date(`${String(win.redeemedAt).replace(' ', 'T')}Z`);
      const time = document.createElement('time');
      if (!Number.isNaN(redeemedAt.getTime())) {
        time.dateTime = redeemedAt.toISOString();
        time.textContent = new Intl.DateTimeFormat(undefined, {
          month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit'
        }).format(redeemedAt);
      } else {
        time.textContent = win.redeemedAt || '';
      }

      const amount = document.createElement('strong');
      amount.className = 'fortune-win-amount';
      amount.textContent = `+${Number(win.amount).toLocaleString()}`;

      details.append(code, time);
      item.append(icon, details, amount);
      fortuneWinsList.append(item);
    });
  };

  const loadFortuneStatus = async () => {
    if (!fortuneTotal || !fortuneWinsList) return;
    const result = await apiRequest('/api/fortune');
    fortuneTotal.textContent = currency(result.totalWon);
    renderFortuneWins(result.wins || []);
  };

  if (fortuneTotal) {
    loadFortuneStatus().catch((error) => {
      fortuneTotal.textContent = currency(0);
      renderFortuneWins([]);
      if (fortuneEmptyState) fortuneEmptyState.textContent = error.message;
    });
  }

  if (fortuneOverlay && fortuneOpenButton && fortuneCloseButton && fortuneCodeForm) {
    let previouslyFocusedElement = null;

    const showFortuneResult = (message, type = 'error') => {
      fortuneResult.textContent = message;
      fortuneResult.className = `fortune-result is-visible is-${type}`;
    };

    const closeFortuneModal = () => {
      fortuneOverlay.classList.remove('is-open');
      fortuneOverlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('fortune-modal-open');
      fortuneCodeForm.reset();
      fortuneResult.textContent = '';
      fortuneResult.className = 'fortune-result';
      fortuneEnvelope.textContent = '💌';
      fortuneModalTitle.textContent = 'Enter Fortune Code';
      fortuneModalDescription.textContent = 'Paste your code below and hit win!';
      fortuneWinButton.disabled = false;
      fortuneWinButton.textContent = '🎯 Win';
      previouslyFocusedElement?.focus();
    };

    fortuneOpenButton.addEventListener('click', () => {
      previouslyFocusedElement = document.activeElement;
      fortuneOverlay.classList.add('is-open');
      fortuneOverlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('fortune-modal-open');
      fortuneCodeInput.focus();
    });

    fortuneCloseButton.addEventListener('click', closeFortuneModal);
    fortuneOverlay.addEventListener('click', (event) => {
      if (event.target === fortuneOverlay) closeFortuneModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && fortuneOverlay.classList.contains('is-open')) {
        closeFortuneModal();
      }
    });

    fortuneCodeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = fortuneCodeInput.value.trim().toUpperCase();
      fortuneCodeInput.value = code;

      if (!code) {
        showFortuneResult('⚠️ Please enter a code.');
        fortuneCodeInput.focus();
        return;
      }

      fortuneWinButton.disabled = true;
      fortuneWinButton.textContent = '🎲 Rolling...';
      fortuneResult.className = 'fortune-result';
      fortuneEnvelope.textContent = '🎰';

      apiRequest('/api/fortune/redeem', {
        method: 'POST',
        body: JSON.stringify({ code })
      })
        .then(async (result) => {
          fortuneEnvelope.textContent = '🎉';
          fortuneModalTitle.textContent = 'You won!';
          fortuneModalDescription.textContent = result.message;
          showFortuneResult(`💰 ${result.message}`, 'success');
          fortuneTotal.textContent = currency(result.totalWon);
          fortuneWinButton.disabled = true;
          fortuneWinButton.textContent = '🎉 Claimed';
          if (result.wallet) {
            appState.wallet.withdrawable = Number(result.wallet.withdrawable);
            appState.wallet.total = Number(result.wallet.total);
            writeState(appState);
            updateBalanceDisplays();
          }
          await loadFortuneStatus().catch(() => {});
        })
        .catch((error) => {
          fortuneEnvelope.textContent = '💔';
          fortuneModalTitle.textContent = 'Try again';
          fortuneModalDescription.textContent = error.message || 'Invalid code.';
          showFortuneResult(error.message || 'Invalid code.');
        })
        .finally(() => {
          if (!fortuneResult.classList.contains('is-success')) {
            fortuneWinButton.disabled = false;
            fortuneWinButton.textContent = '🎯 Win';
          }
        });
    });
  }

  const rewardButton = document.getElementById('claimRewardBtn');
  if (rewardButton) {
    apiRequest('/api/rewards/status')
      .then((result) => {
        appState.rewards.points = result.points;
        appState.rewards.tier = result.tier;
        appState.rewards.boost = result.boost;
        writeState(appState);
        updateRewardDisplays();
        rewardButton.disabled = !result.eligible || result.claimed;
        rewardButton.textContent = result.claimed ? 'Reward claimed' : 'No reward available';
      })
      .catch((error) => setPageMessage(error.message || 'Unable to load reward status.', 'error'));

    rewardButton.addEventListener('click', () => {
      apiRequest('/api/rewards/claim', {
        method: 'POST',
        body: JSON.stringify({})
      })
        .then((result) => {
          if (!result.eligible) {
            rewardButton.disabled = true;
            rewardButton.textContent = 'No reward available';
          }
          setPageMessage(result.message, result.success ? 'success' : 'error');
        })
        .catch((error) => {
          setPageMessage(error.message || 'Unable to claim reward.', 'error');
        });
    });
  }

  const teamLevelCards = document.querySelectorAll('.team-level-grid > div');
  const myTeamHeading = document.getElementById('myTeamHeading');
  if (teamLevelCards.length || myTeamHeading) {
    apiRequest('/api/team')
      .then((result) => {
        const { direct, level2, total } = result.team || {};
        const values = [direct, level2, 0];
        teamLevelCards.forEach((card, index) => {
          const strong = card.querySelector('strong');
          if (strong && values[index] !== undefined) strong.textContent = String(values[index]);
        });
        if (myTeamHeading) {
          myTeamHeading.textContent = `My Team (${total || 0})`;
        }
      })
      .catch((error) => {
        if (myTeamHeading) myTeamHeading.textContent = 'My Team (0)';
      });
  }

  const planMessage = document.getElementById('planMessage');
  const currentPlan = document.querySelector('[data-plan-current]');
  if (currentPlan) {
    apiRequest('/api/plans/current')
      .then((result) => {
        currentPlan.textContent = `${result.selection.plan.toUpperCase()} · ${result.selection.status.replace('_', ' ')}`;
      })
      .catch((error) => {
        if (planMessage) planMessage.textContent = error.message || 'Unable to load plan status.';
      });
  }

  const planButtons = document.querySelectorAll('[data-plan-select]');
  planButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const plan = button.getAttribute('data-plan-select');
      button.disabled = true;
      try {
        const result = await apiRequest('/api/plans/select', {
          method: 'POST',
          body: JSON.stringify({ plan })
        });
        if (currentPlan) {
          currentPlan.textContent = `${result.selection.plan.toUpperCase()} · ${result.selection.status.replace('_', ' ')}`;
        }
        if (planMessage) {
          planMessage.textContent = result.message;
          planMessage.classList.add('success');
          planMessage.classList.remove('error');
        }
      } catch (error) {
        if (planMessage) {
          planMessage.textContent = error.message || 'Unable to select this plan.';
          planMessage.classList.add('error');
          planMessage.classList.remove('success');
        }
      } finally {
        button.disabled = false;
      }
    });
  });

  const videoTrack = document.getElementById('kidsVideoGrid');
  if (videoTrack) {
    const videoCards = Array.from(videoTrack.querySelectorAll('.video-card'));
    const videos = videoCards.map((card) => card.querySelector('.kids-video'));
    const videoButtons = videoCards.map((card) => card.querySelector('.video-play'));
    const videoStatus = document.getElementById('videoPlaybackStatus');
    const nextVideoButton = document.getElementById('nextKidsVideo');
    const soundButton = document.querySelector('.hero-audio');
    let activeVideo = null;
    let requestedVideo = null;
    let selectedVideoIndex = 0;

    const setVideoStatus = (text) => {
      if (videoStatus) videoStatus.textContent = text;
    };

    videos.forEach((video, index) => {
      const button = videoButtons[index];
      const title = video.getAttribute('aria-label').replace(' video', '');

      video.addEventListener('play', () => {
        if (requestedVideo && requestedVideo !== video) {
          video.pause();
          return;
        }
        requestedVideo = video;
        selectedVideoIndex = index;
        videos.forEach((otherVideo) => {
          if (otherVideo !== video) otherVideo.pause();
        });
        setVideoStatus('LOADING');
      });

      video.addEventListener('playing', () => {
        if (requestedVideo !== video) {
          video.pause();
          return;
        }
        videos.forEach((otherVideo) => {
          if (otherVideo !== video) otherVideo.pause();
        });
        activeVideo = video;
        selectedVideoIndex = index;
        button.textContent = '❚❚';
        button.setAttribute('aria-label', `Pause ${title}`);
        button.setAttribute('aria-pressed', 'true');
        setVideoStatus('PLAYING');
      });

      video.addEventListener('pause', () => {
        if (!video.paused) return;
        button.textContent = '▶';
        button.setAttribute('aria-label', `Play ${title}`);
        button.setAttribute('aria-pressed', 'false');
        if (activeVideo === video) activeVideo = null;
        if (requestedVideo === video) requestedVideo = null;
        if (!requestedVideo && videos.every((otherVideo) => otherVideo.paused)) {
          setVideoStatus('READY');
        }
      });

      video.addEventListener('error', () => {
        if (requestedVideo === video) {
          requestedVideo = null;
          setVideoStatus('VIDEO UNAVAILABLE');
        }
      });

      button.addEventListener('click', () => {
        selectedVideoIndex = index;
        if (video.paused) {
          requestedVideo = video;
          setVideoStatus('LOADING');
          video.play().catch(() => {
            if (requestedVideo === video) requestedVideo = null;
            setVideoStatus('TAP TO PLAY');
          });
        } else {
          if (requestedVideo === video) requestedVideo = null;
          video.pause();
        }
      });
    });

    if (nextVideoButton) {
      nextVideoButton.addEventListener('click', () => {
        selectedVideoIndex = (selectedVideoIndex + 1) % videoCards.length;
        const card = videoCards[selectedVideoIndex];
        const trackLeft = videoTrack.getBoundingClientRect().left;
        const cardLeft = card.getBoundingClientRect().left;
        videoTrack.scrollBy({ left: cardLeft - trackLeft, behavior: 'smooth' });
      });
    }

    if (soundButton) {
      soundButton.addEventListener('click', () => {
        const targetVideo = activeVideo || videos[selectedVideoIndex];
        targetVideo.muted = !targetVideo.muted;
        soundButton.textContent = targetVideo.muted ? '◉' : '♪';
        soundButton.setAttribute('aria-label', targetVideo.muted ? 'Unmute selected video' : 'Mute selected video');
      });
    }
  }

  const heroSlider = document.getElementById('heroSlider');
  if (heroSlider) {
    const heroSlides = Array.from(heroSlider.querySelectorAll('[data-hero-slide]'));
    const heroDots = Array.from(heroSlider.querySelectorAll('[data-hero-dot]'));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let activeSlideIndex = 0;
    let slideTimer = null;
    let pointerStartX = null;

    const showHeroSlide = (index) => {
      activeSlideIndex = (index + heroSlides.length) % heroSlides.length;
      heroSlides.forEach((slide, slideIndex) => {
        const isActive = slideIndex === activeSlideIndex;
        slide.classList.toggle('is-active', isActive);
        slide.setAttribute('aria-hidden', String(!isActive));
        slide.inert = !isActive;
        heroDots[slideIndex].classList.toggle('is-active', isActive);
        heroDots[slideIndex].setAttribute('aria-pressed', String(isActive));
      });
    };

    const stopHeroTimer = () => {
      window.clearInterval(slideTimer);
      slideTimer = null;
    };

    const startHeroTimer = () => {
      stopHeroTimer();
      if (reducedMotion.matches || document.hidden || heroSlider.matches(':hover') || heroSlider.contains(document.activeElement)) return;
      slideTimer = window.setInterval(() => showHeroSlide(activeSlideIndex + 1), 6500);
    };

    heroDots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        showHeroSlide(index);
        startHeroTimer();
      });
    });

    heroSlider.addEventListener('mouseenter', stopHeroTimer);
    heroSlider.addEventListener('mouseleave', startHeroTimer);
    heroSlider.addEventListener('focusin', stopHeroTimer);
    heroSlider.addEventListener('focusout', (event) => {
      if (!heroSlider.contains(event.relatedTarget)) startHeroTimer();
    });
    heroSlider.addEventListener('pointerdown', (event) => {
      pointerStartX = event.clientX;
    });
    heroSlider.addEventListener('pointerup', (event) => {
      if (pointerStartX === null) return;
      const swipeDistance = event.clientX - pointerStartX;
      pointerStartX = null;
      if (Math.abs(swipeDistance) < 45) return;
      showHeroSlide(activeSlideIndex + (swipeDistance < 0 ? 1 : -1));
      startHeroTimer();
    });
    document.addEventListener('visibilitychange', startHeroTimer);
    reducedMotion.addEventListener('change', startHeroTimer);
    showHeroSlide(0);
    startHeroTimer();
  }

  syncAppData();
});
