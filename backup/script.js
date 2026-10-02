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
    const isLocalPreview = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
    if (window.location.protocol === 'file:' || isLocalPreview) {
      return 'http://localhost:3000';
    }
    return window.location.origin;
  })();

  const defaultState = {
    loggedIn: null,
    user: {
      username: 'fred',
      password: 'fredo@2003',
      fullName: 'Fred Murph',
      email: 'fred@xplode.com',
      mobile: '+256 700 123 456',
      inviteCode: '9700',
      pin: '1234'
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
    team: {
      members: 0,
      active: 0,
      teams: 0
    },
    salaries: {
      teamSize: 0,
      paid: 0,
      due: 0
    },
    fortune: {
      streak: 0,
      score: 0,
      next: 'No verified result'
    },
    profile: {
      works: 0,
      followers: '0',
      following: 0,
      bio: 'Building surreal motion artwork and collectible digital objects rooted in emotion, rhythm, and futurism.'
    }
  };

  function readState() {
    try {
      const raw = localStorage.getItem('xpAppState');
      if (!raw) {
        localStorage.setItem('xpAppState', JSON.stringify(defaultState));
        return structuredClone(defaultState);
      }
      const parsed = JSON.parse(raw);
      return { ...structuredClone(defaultState), ...parsed, user: { ...defaultState.user, ...(parsed.user || {}) }, wallet: { ...defaultState.wallet, ...(parsed.wallet || {}) }, rewards: { ...defaultState.rewards }, team: { ...defaultState.team }, salaries: { ...defaultState.salaries }, fortune: { ...defaultState.fortune }, profile: { ...defaultState.profile, ...(parsed.profile || {}), works: 0, followers: '0', following: 0 } };
    } catch (error) {
      localStorage.setItem('xpAppState', JSON.stringify(defaultState));
      return structuredClone(defaultState);
    }
  }

  function writeState(state) {
    localStorage.setItem('xpAppState', JSON.stringify(state));
  }

  const appState = readState();
  const isLoggedIn = Boolean(localStorage.getItem('xpLogin'));

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
      throw new Error('Cannot reach the XPLODE backend. Start it with "npm run dev" and try again.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Request failed');
    }
    return payload;
  }

  function redirectToLogin() {
    window.location.href = 'index.html';
  }

  if (!['index.html', 'register.html'].includes(currentPage) && !appPages.has(currentPage)) {
    redirectToLogin();
    return;
  }

  if (!['index.html', 'register.html'].includes(currentPage) && !isLoggedIn) {
    redirectToLogin();
    return;
  }

  if (currentPage === 'index.html' && isLoggedIn) {
    window.location.href = 'dashboard.html';
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
    if (heading) {
      heading.textContent = appState.user.fullName;
    }

    const username = document.getElementById('profileUsername');
    if (username) username.textContent = `@${appState.user.username}`;

    const avatar = document.getElementById('accountAvatar');
    if (avatar) {
      avatar.textContent = appState.user.fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');
    }

    const inviteCode = String(appState.user.invite_code || appState.user.inviteCode || '9700');
    document.querySelectorAll('#profileInviteCode, #teamInviteCode').forEach((node) => {
      node.textContent = inviteCode;
    });

    const inviteLink = document.getElementById('teamInviteLink');
    if (inviteLink) {
      const url = new URL('register.html', window.location.href);
      url.searchParams.set('ref', inviteCode);
      inviteLink.textContent = url.toString();
    }

    const myTeamCount = document.getElementById('myTeamCount');
    if (myTeamCount) myTeamCount.textContent = appState.team.members;

    const workCount = document.querySelector('[data-stat="works"]');
    if (workCount) workCount.textContent = appState.profile.works;

    const followerCount = document.querySelector('[data-stat="followers"]');
    if (followerCount) followerCount.textContent = appState.profile.followers;

    const followingCount = document.querySelector('[data-stat="following"]');
    if (followingCount) followingCount.textContent = appState.profile.following;
  }

  async function copyAccountValue(value, button, successText = 'Copied') {
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
      node.textContent = appState.rewards.points.toLocaleString();
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

  function updateTeamDisplays() {
    const membersEls = document.querySelectorAll('[data-team="members"]');
    membersEls.forEach((node) => { node.textContent = appState.team.members; });

    const activeEls = document.querySelectorAll('[data-team="active"]');
    activeEls.forEach((node) => { node.textContent = `${appState.team.active}%`; });

    const teamsEls = document.querySelectorAll('[data-team="teams"]');
    teamsEls.forEach((node) => { node.textContent = appState.team.teams; });
  }

  function updateSalaryDisplays() {
    const teamEls = document.querySelectorAll('[data-salary="team"]');
    teamEls.forEach((node) => {
      node.textContent = appState.salaries.teamSize;
    });

    const paidEls = document.querySelectorAll('[data-salary="paid"]');
    paidEls.forEach((node) => {
      node.textContent = currency(appState.salaries.paid);
    });

    const dueEls = document.querySelectorAll('[data-salary="due"]');
    dueEls.forEach((node) => {
      node.textContent = currency(appState.salaries.due);
    });
  }

  function updateFortuneDisplays() {
    const streakEls = document.querySelectorAll('[data-fortune="streak"]');
    streakEls.forEach((node) => {
      node.textContent = `${appState.fortune.streak} Days`;
    });

    const scoreEls = document.querySelectorAll('[data-fortune="score"]');
    scoreEls.forEach((node) => {
      node.textContent = appState.fortune.score.toFixed(1);
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
    updateTeamDisplays();
    updateSalaryDisplays();
    updateFortuneDisplays();
    if (document.querySelector('.balance-box strong')) {
      document.querySelector('.balance-box strong').textContent = currency(appState.wallet.withdrawable);
    }
  }

  document.querySelectorAll('.nav-item').forEach((link) => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }

    if (link.textContent.trim() === 'Log out') {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        localStorage.removeItem('xpLogin');
        localStorage.removeItem('xpToken');
        localStorage.removeItem('xpAppState');
        window.location.href = 'index.html';
      });
    }
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

    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();

      if (!username || !password) {
        message.textContent = 'Please enter both your username and password.';
        message.classList.remove('success');
        return;
      }

      apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
        .then((result) => {
          const nextState = {
            ...structuredClone(defaultState),
            ...result,
            loggedIn: result.user.username,
            user: { ...defaultState.user, ...result.user, fullName: result.user.full_name || result.user.username },
            wallet: { ...defaultState.wallet, ...(result.wallet || {}) }
          };
          writeState(nextState);
          localStorage.setItem('xpToken', result.token);
          localStorage.setItem('xpLogin', result.user.username);
          message.textContent = result.message || 'Login successful. Welcome back!';
          message.classList.add('success');
          setTimeout(() => {
            window.location.href = 'dashboard.html';
          }, 300);
        })
        .catch((error) => {
          message.textContent = error.message || 'Incorrect username or password.';
          message.classList.remove('success');
        });
    });
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    const message = document.getElementById('registerMessage');
    const inviteField = document.getElementById('inviteCode');
    const referralFromUrl = new URLSearchParams(window.location.search).get('ref');
    if (inviteField && referralFromUrl && !inviteField.value) inviteField.value = referralFromUrl;

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

      if (regPassword !== confirmPassword) {
        message.textContent = 'Your passwords do not match.';
        message.classList.remove('success');
        return;
      }

      if (inviteCode && inviteCode !== '9700') {
        message.textContent = 'Invalid invite code.';
        message.classList.remove('success');
        return;
      }

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
            loggedIn: username,
            user: {
              ...defaultState.user,
              ...result.user,
              username,
              fullName: result.user.full_name || username,
              email,
              mobile,
              inviteCode: result.user.invite_code || inviteCode
            },
            wallet: { ...defaultState.wallet, ...(result.wallet || {}) }
          };
          Object.assign(appState, nextState);
          writeState(appState);
          localStorage.setItem('xpToken', result.token);
          localStorage.setItem('xpLogin', username);
          message.textContent = result.message || 'Account created successfully.';
          message.classList.add('success');
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 300);
        })
        .catch((error) => {
          message.textContent = error.message || 'Unable to create account.';
          message.classList.remove('success');
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

    const heroButton = document.querySelector('.ghost-btn');
    if (heroButton && heroButton.textContent.includes('+')) {
      heroButton.addEventListener('click', () => {
        const categoryOptions = ['featured', 'motion', 'portraits'];
        const newCard = document.createElement('article');
        newCard.className = 'gallery-card';
        const category = categoryOptions[Math.floor(Math.random() * categoryOptions.length)];
        newCard.dataset.category = category;
        const artIndex = String(cards.length % 6 + 1);
        newCard.innerHTML = `
          <div class="gallery-art art-${artIndex}"></div>
          <div class="gallery-meta">
            <h3>New Release ${cards.length + 1}</h3>
            <span>${(Math.random() * 2.5 + 0.8).toFixed(1)} ETH</span>
          </div>
        `;
        gallery.appendChild(newCard);
        cards.push(newCard);
        const activeFilter = document.querySelector('.filter.active');
        const filterValue = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
        applyFilter(filterValue === 'all' ? 'all' : filterValue);
      });
    }
  }

  const watchList = document.getElementById('watchList');
  if (watchList) {
    const watchCards = Array.from(watchList.querySelectorAll('.watch-card'));
    let activeWatchIndex = 0;

    const showWatchCard = (index) => {
      activeWatchIndex = (index + watchCards.length) % watchCards.length;
      watchCards[activeWatchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    document.getElementById('watchPrevious')?.addEventListener('click', () => showWatchCard(activeWatchIndex - 1));
    document.getElementById('watchNext')?.addEventListener('click', () => showWatchCard(activeWatchIndex + 1));
  }

  const featureSequence = [
    {
      title: 'Celestial Motion',
      text: 'A limited run of elevated digital pieces built for collectors who want movement, depth, and identity in one frame.',
      meta: ['14 editions', '2.4 ETH'],
      gradient: 'linear-gradient(135deg, #101820 0%, #d15765 100%)'
    },
    {
      title: 'Neon Drift',
      text: 'Smooth gradients, glowing silhouettes, and layered textures that feel cinematic and collectible.',
      meta: ['8 editions', '1.9 ETH'],
      gradient: 'linear-gradient(135deg, #1b2340 0%, #3cc7ff 100%)'
    },
    {
      title: 'Velvet Horizon',
      text: 'An immersive release designed around contrast, soft light, and vivid motion for premium collectors.',
      meta: ['22 editions', '3.1 ETH'],
      gradient: 'linear-gradient(135deg, #2c1a28 0%, #d47e6b 100%)'
    }
  ];

  const featureTitle = document.getElementById('featureTitle');
  const featureText = document.getElementById('featureText');
  const featureMeta = document.getElementById('featureMeta');
  const showcaseCard = document.getElementById('showcaseCard');
  const newDropButton = document.getElementById('newDropBtn');
  const liveToggleButton = document.getElementById('liveToggleBtn');

  if (featureTitle && featureText && featureMeta && showcaseCard) {
    let featureIndex = 0;
    const renderFeature = () => {
      const item = featureSequence[featureIndex];
      featureTitle.textContent = item.title;
      featureText.textContent = item.text;
      featureMeta.innerHTML = item.meta.map((entry) => `<span>${entry}</span>`).join('');
      showcaseCard.style.background = item.gradient;
    };

    if (newDropButton) {
      newDropButton.addEventListener('click', () => {
        featureIndex = (featureIndex + 1) % featureSequence.length;
        renderFeature();
      });
    }

    if (liveToggleButton) {
      liveToggleButton.addEventListener('click', () => {
        const isLive = liveToggleButton.dataset.live === 'true';
        liveToggleButton.dataset.live = String(!isLive);
        liveToggleButton.textContent = isLive ? 'Watching' : 'Live now';
        liveToggleButton.style.background = isLive ? 'rgba(33, 150, 83, 0.12)' : 'rgba(223, 74, 82, 0.12)';
        liveToggleButton.style.color = isLive ? '#1f8d5d' : '#d03b4b';
      });
    }

    renderFeature();
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
      copyAccountValue(document.getElementById('profileInviteCode').textContent, copyProfileInviteButton, '✓');
    });
  }

  const copyTeamInviteCodeButton = document.getElementById('copyTeamInviteCode');
  if (copyTeamInviteCodeButton) {
    copyTeamInviteCodeButton.addEventListener('click', () => {
      copyAccountValue(document.getElementById('teamInviteCode').textContent, copyTeamInviteCodeButton);
    });
  }

  const copyTeamInviteLinkButton = document.getElementById('copyTeamInviteLink');
  if (copyTeamInviteLinkButton) {
    copyTeamInviteLinkButton.addEventListener('click', () => {
      copyAccountValue(document.getElementById('teamInviteLink').textContent, copyTeamInviteLinkButton);
    });
  }

  const shareTeamInviteButton = document.getElementById('shareTeamInvite');
  if (shareTeamInviteButton) {
    shareTeamInviteButton.addEventListener('click', async () => {
      const inviteLink = document.getElementById('teamInviteLink').textContent;
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
    const copyButton = document.getElementById('copyDepositNumber');
    const depositNumber = document.getElementById('depositNumber');
    const providerInput = document.getElementById('depositMethod');
    const airtelPaymentDetails = document.getElementById('airtelPaymentDetails');
    const depositHistory = document.getElementById('depositHistory');
    const submitButton = depositForm.querySelector('[type="submit"]');

    const updatePaymentDetails = () => {
      if (airtelPaymentDetails) {
        airtelPaymentDetails.hidden = providerInput.value !== 'Airtel Money';
      }
    };

    providerInput.addEventListener('change', updatePaymentDetails);
    updatePaymentDetails();

    const loadDepositHistory = async () => {
      if (!depositHistory) return;
      try {
        const result = await apiRequest('/api/deposits');
        depositHistory.replaceChildren();
        if (!result.deposits.length) {
          const emptyItem = document.createElement('li');
          const emptyText = document.createElement('div');
          const emptyHeading = document.createElement('strong');
          emptyHeading.textContent = 'No deposits submitted yet';
          emptyText.appendChild(emptyHeading);
          emptyItem.appendChild(emptyText);
          depositHistory.appendChild(emptyItem);
          return;
        }

        result.deposits.forEach((deposit) => {
          const item = document.createElement('li');
          const icon = document.createElement('span');
          const details = document.createElement('div');
          const heading = document.createElement('strong');
          const subtext = document.createElement('small');
          const amount = document.createElement('b');
          const createdAt = new Date(`${deposit.created_at.replace(' ', 'T')}Z`);
          icon.className = 'history-icon incoming';
          icon.textContent = '↗';
          heading.textContent = currency(deposit.amount);
          subtext.textContent = `${deposit.provider} · ${deposit.status} · ${createdAt.toLocaleDateString()}`;
          amount.textContent = deposit.status === 'pending' ? 'Pending' : deposit.status;
          details.append(heading, subtext);
          item.append(icon, details, amount);
          depositHistory.appendChild(item);
        });
      } catch (error) {
        depositHistory.replaceChildren();
        const item = document.createElement('li');
        const message = document.createElement('div');
        message.textContent = error.message || 'Unable to load deposit history.';
        item.appendChild(message);
        depositHistory.appendChild(item);
      }
    };

    loadDepositHistory();

    if (copyButton && depositNumber) {
      copyButton.addEventListener('click', async () => {
        const number = depositNumber.textContent.trim();
        try {
          await navigator.clipboard.writeText(number);
          copyButton.textContent = 'Copied';
          copyButton.classList.add('is-copied');
          setTimeout(() => {
            copyButton.textContent = 'Copy number';
            copyButton.classList.remove('is-copied');
          }, 1200);
        } catch (error) {
          copyButton.textContent = 'Copy failed';
          setTimeout(() => {
            copyButton.textContent = 'Copy number';
          }, 1200);
        }
      });
    }

    depositForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!depositForm.reportValidity()) return;
      const providerInput = document.getElementById('depositMethod');
      const amountInput = document.getElementById('depositAmount');
      const transactionIdInput = document.getElementById('depositTransactionId');
      const amount = Number(amountInput.value);
      const provider = providerInput.value;
      const transactionId = transactionIdInput.value.trim();
      if (!Number.isSafeInteger(amount) || amount < 10000) {
        setPageMessage('Minimum deposit is UGX 10,000.', 'error');
        return;
      }

      if (submitButton) submitButton.disabled = true;
      apiRequest('/api/wallet/deposit', {
        method: 'POST',
        body: JSON.stringify({ amount, provider, transactionId })
      })
        .then((result) => {
          depositForm.reset();
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
    const copyButton = document.getElementById('copyWithdrawNumber');
    const withdrawNumber = document.getElementById('withdrawNumber');
    const withdrawalHistory = document.getElementById('withdrawalHistory');
    const submitButton = withdrawForm.querySelector('[type="submit"]');

    if (withdrawNumber && appState.user.mobile) {
      withdrawNumber.textContent = appState.user.mobile;
    }

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
          const createdAt = new Date(`${withdrawal.created_at.replace(' ', 'T')}Z`);
          icon.className = 'history-icon outgoing';
          icon.textContent = '↘';
          heading.textContent = currency(withdrawal.amount);
          subtext.textContent = `${withdrawal.status} · ${createdAt.toLocaleDateString()}`;
          status.textContent = withdrawal.status;
          details.append(heading, subtext);
          item.append(icon, details, status);
          withdrawalHistory.appendChild(item);
        });
      } catch (error) {
        withdrawalHistory.replaceChildren();
        const item = document.createElement('li');
        const message = document.createElement('div');
        message.textContent = error.message || 'Unable to load withdrawal history.';
        item.appendChild(message);
        withdrawalHistory.appendChild(item);
      }
    };

    loadWithdrawalHistory();

    if (copyButton && withdrawNumber) {
      copyButton.addEventListener('click', async () => {
        const number = withdrawNumber.textContent.trim();
        try {
          await navigator.clipboard.writeText(number);
          copyButton.textContent = 'Copied';
          copyButton.classList.add('is-copied');
          setTimeout(() => {
            copyButton.textContent = 'Copy number';
            copyButton.classList.remove('is-copied');
          }, 1200);
        } catch (error) {
          copyButton.textContent = 'Copy failed';
          setTimeout(() => {
            copyButton.textContent = 'Copy number';
          }, 1200);
        }
      });
    }

    withdrawForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!withdrawForm.reportValidity()) return;
      const amountInput = document.getElementById('withdrawAmount');
      const pinInput = document.getElementById('withdrawPin');
      const amount = Number(amountInput.value);
      const pin = pinInput.value.trim();

      if (!Number.isSafeInteger(amount) || amount < 500) {
        setPageMessage('Minimum withdrawal is UGX 500.', 'error');
        return;
      }

      if (submitButton) submitButton.disabled = true;
      apiRequest('/api/wallet/withdraw', {
        method: 'POST',
        body: JSON.stringify({ amount, pin })
      })
        .then((result) => {
          withdrawForm.reset();
          setPageMessage(result.message, 'success');
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
        setPageMessage(result.message, 'error');
      })
      .catch((error) => setPageMessage(error.message || 'Unable to load reward status.', 'error'));

    rewardButton.addEventListener('click', () => {
      apiRequest('/api/rewards/claim', {
        method: 'POST',
        body: JSON.stringify({ userId: 1 })
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
