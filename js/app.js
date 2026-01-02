// kaiZEN - Personal-first app with optional group sync

class KaizenApp {
  constructor() {
    this.db = null;
    this.scope = 'personal'; // 'personal' | 'group'
    this.groupCode = null;
    this.groupRoot = null; // 'groups' | 'families' (legacy compatibility)
    this.userName = null;
    this.userKey = null;
    this.unsubscribers = [];
    this.data = {
      goals: [],
      habits: [],
      wins: [],
      reflections: [],
      groupMembers: []
    };

    this._firebaseBootstrapped = false;
    
    this.init();
  }

  async init() {
    // Migrate legacy keys from the old family-based version
    this.migrateLegacyLocalStorage();
    
    // Personal identity is required; group is optional
    this.userName = localStorage.getItem('kaizen_user_name');
    this.groupCode = this.normalizeStoredGroupCode(localStorage.getItem('kaizen_group_code'));
    this.groupRoot = localStorage.getItem('kaizen_group_root');

    this.userKey = this.userName ? this.normalizeKey(this.userName) : null;

    // Set up UI wiring immediately so the app remains usable even if Firebase is
    // blocked or slow (previously init() would await Firebase forever).
    if (this.groupCode) {
      this.scope = 'group';
    } else {
      this.scope = 'personal';
    }

    if (this.userName) {
      this.hideSetupModal();
    } else {
      this.showSetupModal();
    }

    this.setupNavigation();
    this.setupEventListeners();
    this.setupMeetingTimer();
    this.setupNotifications();

    // Enable realtime features as soon as Firebase becomes available.
    // We don't await this to avoid blocking UI wiring.
    this.bootstrapFirebaseWhenReady();
  }

  bootstrapFirebaseWhenReady() {
    if (this._firebaseBootstrapped) return;
    this._firebaseBootstrapped = true;

    // Wait forever in the background; this resolves only once Firebase globals exist.
    this.waitForFirebase(0).then(async (ready) => {
      if (!ready) return;
      if (!this.userName) return;

      if (this.groupCode) {
        this.scope = 'group';
        if (!this.groupRoot) {
          await this.determineGroupRootForCode(this.groupCode);
        }
      } else {
        this.scope = 'personal';
      }

      this.setupRealtimeListeners();
    });
  }

  normalizeStoredGroupCode(raw) {
    const value = (raw || '').trim().toUpperCase();
    if (!value) return null;
    if (value === 'NULL' || value === 'UNDEFINED') return null;
    // Codes are typically 6 chars, but allow a little flexibility.
    if (!/^[A-Z0-9]{4,12}$/.test(value)) return null;
    return value;
  }

  migrateLegacyLocalStorage() {
    const legacyFamilyCode = localStorage.getItem('kaizen_family_code');
    const legacyMemberName = localStorage.getItem('kaizen_member_name');

    if (legacyMemberName && !localStorage.getItem('kaizen_user_name')) {
      localStorage.setItem('kaizen_user_name', legacyMemberName);
    }

    // If the user previously used a family code, treat it as a legacy group code
    if (legacyFamilyCode && !localStorage.getItem('kaizen_group_code')) {
      localStorage.setItem('kaizen_group_code', legacyFamilyCode);
    }

    // Preserve legacy storage root so existing data continues to show up
    if (legacyFamilyCode && !localStorage.getItem('kaizen_group_root')) {
      localStorage.setItem('kaizen_group_root', 'families');
    }
  }

  normalizeKey(name) {
    return (name || '').trim().toLowerCase();
  }

  async determineGroupRootForCode(code) {
    const upper = (code || '').trim().toUpperCase();
    if (!upper) return;

    try {
      const groupDoc = await this.helpers.getDoc(this.helpers.doc(this.db, 'groups', upper));
      if (groupDoc.exists()) {
        this.groupRoot = 'groups';
        localStorage.setItem('kaizen_group_root', 'groups');
        return;
      }

      const legacyFamilyDoc = await this.helpers.getDoc(this.helpers.doc(this.db, 'families', upper));
      if (legacyFamilyDoc.exists()) {
        this.groupRoot = 'families';
        localStorage.setItem('kaizen_group_root', 'families');
        return;
      }

      // Default to new groups collection
      this.groupRoot = 'groups';
      localStorage.setItem('kaizen_group_root', 'groups');
    } catch (e) {
      // If Firestore is unavailable, default and let normal error handling surface elsewhere
      this.groupRoot = this.groupRoot || 'groups';
      localStorage.setItem('kaizen_group_root', this.groupRoot);
    }
  }

  getRootPath() {
    if (this.scope === 'group') {
      return [this.groupRoot || 'groups', this.groupCode];
    }
    return ['users', this.userKey];
  }

  collectionInScope(subcollection) {
    return this.helpers.collection(this.db, ...this.getRootPath(), subcollection);
  }

  docInScope(subcollection, docId) {
    return this.helpers.doc(this.db, ...this.getRootPath(), subcollection, docId);
  }

  async waitForFirebase(timeoutMs = 8000) {
    if (this.db && this.helpers) return true;
    return new Promise((resolve) => {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      const check = () => {
        if (window.firebaseDB && window.firebaseHelpers) {
          this.db = window.firebaseDB;
          this.helpers = window.firebaseHelpers;
          resolve(true);
        } else {
          if (timeoutMs && Date.now() > deadline) {
            resolve(false);
            return;
          }
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // =====================
  // SETUP & AUTHENTICATION
  // =====================

  showSetupModal() {
    const modal = document.createElement('div');
    modal.id = 'setupModal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content setup-modal">
        <div class="modal-header">
          <h2>🌱 Welcome to kaiZEN!</h2>
        </div>
        <div class="modal-body">
          <p class="setup-intro">Start personal kaiZEN in seconds. Optionally join a group for shared goals and wins.</p>
          
          <div class="setup-tabs">
            <button class="setup-tab active" data-tab="personal">Personal</button>
            <button class="setup-tab" data-tab="join">Join Group</button>
            <button class="setup-tab" data-tab="create">Create Group</button>
          </div>
          
          <div class="setup-panel active" id="personalPanel">
            <div class="form-group">
              <label for="personalName">Your Name</label>
              <input type="text" id="personalName" placeholder="What should I call you?" class="form-input">
            </div>
            <button class="btn btn-primary btn-block" id="startPersonalBtn">Continue</button>
          </div>

          <div class="setup-panel" id="joinPanel">
            <div class="form-group">
              <label for="joinCode">Group Code</label>
              <input type="text" id="joinCode" placeholder="Enter a group code" class="form-input" maxlength="8" style="text-transform: uppercase;">
              <small>Ask someone in the group for the code</small>
            </div>
            <div class="form-group">
              <label for="joinName">Your Name</label>
              <input type="text" id="joinName" placeholder="What should I call you?" class="form-input">
            </div>
            <button class="btn btn-primary btn-block" id="joinGroupBtn">Join Group</button>
          </div>
          
          <div class="setup-panel" id="createPanel">
            <div class="form-group">
              <label for="groupName">Group Name</label>
              <input type="text" id="groupName" placeholder="e.g., Friends, Team, Study Group" class="form-input">
            </div>
            <div class="form-group">
              <label for="createName">Your Name</label>
              <input type="text" id="createName" placeholder="What should I call you?" class="form-input">
            </div>
            <button class="btn btn-primary btn-block" id="createGroupBtn">Create Group</button>
          </div>
          
          <div id="setupError" class="error-message" style="display: none;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Setup tab switching
    modal.querySelectorAll('.setup-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.setup-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.setup-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
      });
    });
    
    // Personal
    document.getElementById('startPersonalBtn').addEventListener('click', () => this.startPersonal());

    // Join group
    document.getElementById('joinGroupBtn').addEventListener('click', () => this.joinGroup());
    
    // Create group
    document.getElementById('createGroupBtn').addEventListener('click', () => this.createGroup());
  }

  hideSetupModal() {
    const modal = document.getElementById('setupModal');
    if (modal) modal.remove();
  }

  ensureSetupModal() {
    if (document.getElementById('setupModal')) return;
    this.showSetupModal();

    if (this.userName) {
      const personalNameInput = document.getElementById('personalName');
      if (personalNameInput) personalNameInput.value = this.userName;
      const joinNameInput = document.getElementById('joinName');
      if (joinNameInput) joinNameInput.value = this.userName;
      const createNameInput = document.getElementById('createName');
      if (createNameInput) createNameInput.value = this.userName;
    }
  }

  openSetupTab(tab = 'personal') {
    this.ensureSetupModal();
    const modal = document.getElementById('setupModal');
    if (!modal) return;

    modal.querySelectorAll('.setup-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    modal.querySelectorAll('.setup-panel').forEach(p => {
      p.classList.toggle('active', p.id === `${tab}Panel`);
    });

    const errorEl = document.getElementById('setupError');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  async startPersonal() {
    const name = document.getElementById('personalName').value.trim();
    const errorEl = document.getElementById('setupError');

    if (!name) {
      errorEl.textContent = 'Please enter your name.';
      errorEl.style.display = 'block';
      return;
    }

    this.userName = name;
    this.userKey = this.normalizeKey(name);
    this.scope = 'personal';
    localStorage.setItem('kaizen_user_name', name);

    this.hideSetupModal();
    this.setupRealtimeListeners();
    this.showToast(`Welcome, ${name}! 🌱`);
  }

  async joinGroup() {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    const name = document.getElementById('joinName').value.trim();
    const errorEl = document.getElementById('setupError');

    if (!code || !name) {
      errorEl.textContent = 'Please enter both the group code and your name.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      // Prefer new groups collection, fall back to legacy families collection
      let root = 'groups';
      const groupDoc = await this.helpers.getDoc(this.helpers.doc(this.db, 'groups', code));
      if (!groupDoc.exists()) {
        const legacyDoc = await this.helpers.getDoc(this.helpers.doc(this.db, 'families', code));
        if (!legacyDoc.exists()) {
          errorEl.textContent = 'Group not found. Check the code and try again.';
          errorEl.style.display = 'block';
          return;
        }
        root = 'families';
      }

      await this.helpers.setDoc(
        this.helpers.doc(this.db, root, code, 'members', this.normalizeKey(name)),
        {
          name,
          joinedAt: new Date().toISOString(),
          lastActive: new Date().toISOString()
        },
        { merge: true }
      );

      this.userName = name;
      this.userKey = this.normalizeKey(name);
      this.groupCode = code;
      this.groupRoot = root;
      this.scope = 'group';

      localStorage.setItem('kaizen_user_name', name);
      localStorage.setItem('kaizen_group_code', code);
      localStorage.setItem('kaizen_group_root', root);

      this.hideSetupModal();
      this.setupRealtimeListeners();
      this.showToast(`Joined group as ${name}! 🎉`);
    } catch (error) {
      console.error('Error joining group:', error);
      errorEl.textContent = 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
    }
  }

  async createGroup() {
    const groupName = document.getElementById('groupName').value.trim();
    const name = document.getElementById('createName').value.trim();
    const errorEl = document.getElementById('setupError');

    if (!name) {
      errorEl.textContent = 'Please enter your name.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const code = this.generateGroupCode();

      await this.helpers.setDoc(
        this.helpers.doc(this.db, 'groups', code),
        {
          name: groupName || 'Group',
          createdAt: new Date().toISOString(),
          createdBy: name
        }
      );

      await this.helpers.setDoc(
        this.helpers.doc(this.db, 'groups', code, 'members', this.normalizeKey(name)),
        {
          name,
          joinedAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          isCreator: true
        }
      );

      this.userName = name;
      this.userKey = this.normalizeKey(name);
      this.groupCode = code;
      this.groupRoot = 'groups';
      this.scope = 'group';

      localStorage.setItem('kaizen_user_name', name);
      localStorage.setItem('kaizen_group_code', code);
      localStorage.setItem('kaizen_group_root', 'groups');

      this.hideSetupModal();
      this.setupRealtimeListeners();

      this.showGroupCodeModal(code, groupName || 'Group');
    } catch (error) {
      console.error('Error creating group:', error);
      errorEl.textContent = 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
    }
  }

  generateGroupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  showGroupCodeModal(code, groupName) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>🎉 Group Created!</h2>
        </div>
        <div class="modal-body" style="text-align: center;">
          <p>Share this code so others can join your group:</p>
          <div class="group-code-display">${code}</div>
          <p class="small">They'll need this code to join "${groupName}"</p>
          <button class="btn btn-primary" id="copyCodeBtn">📋 Copy Code</button>
          <button class="btn btn-outline" id="closeCodeModal">Got it!</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('copyCodeBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(code);
      this.showToast('Code copied to clipboard!');
    });

    document.getElementById('closeCodeModal').addEventListener('click', () => {
      modal.remove();
    });
  }

  // =====================
  // REAL-TIME DATA SYNC
  // =====================

  setupRealtimeListeners() {
    if (!this.userKey) return;

    // If group info is missing, fall back to personal mode
    if (this.scope === 'group' && !this.groupCode) {
      this.scope = 'personal';
    }
    
    // Clear existing listeners
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    
    // Track if this is initial load (don't notify on initial load)
    this.initialLoadComplete = false;
    let loadCount = 0;
    const totalCollections = this.scope === 'group' ? 5 : 4;
    const checkInitialLoad = () => {
      loadCount++;
      if (loadCount >= totalCollections) {
        setTimeout(() => { this.initialLoadComplete = true; }, 1000);
      }
    };
    
    // Listen to goals
    const goalsRef = this.collectionInScope('goals');
    this.unsubscribers.push(
      this.helpers.onSnapshot(goalsRef, (snapshot) => {
        const oldGoals = [...this.data.goals];
        this.data.goals = [];
        snapshot.forEach(doc => {
          this.data.goals.push({ id: doc.id, ...doc.data() });
        });
        
        // Check for new goals or completed goals from others
        if (this.initialLoadComplete) {
          this.checkForGoalChanges(oldGoals, this.data.goals);
        }
        
        this.renderGoals();
        this.renderDashboard();
        checkInitialLoad();
      })
    );
    
    // Listen to habits
    const habitsRef = this.collectionInScope('habits');
    this.unsubscribers.push(
      this.helpers.onSnapshot(habitsRef, (snapshot) => {
        const oldHabits = [...this.data.habits];
        this.data.habits = [];
        snapshot.forEach(doc => {
          this.data.habits.push({ id: doc.id, ...doc.data() });
        });
        
        // Check for habit completions from others
        if (this.initialLoadComplete) {
          this.checkForHabitChanges(oldHabits, this.data.habits);
        }
        
        this.renderHabits();
        this.renderDashboard();
        checkInitialLoad();
      })
    );
    
    // Listen to wins
    const winsRef = this.collectionInScope('wins');
    this.unsubscribers.push(
      this.helpers.onSnapshot(winsRef, (snapshot) => {
        const oldWins = [...this.data.wins];
        this.data.wins = [];
        snapshot.forEach(doc => {
          this.data.wins.push({ id: doc.id, ...doc.data() });
        });
        
        // Check for new wins from others
        if (this.initialLoadComplete) {
          this.checkForNewWins(oldWins, this.data.wins);
        }
        
        this.renderDashboard();
        this.renderJournal();
        checkInitialLoad();
      })
    );
    
    // Listen to reflections
    const reflectionsRef = this.collectionInScope('reflections');
    this.unsubscribers.push(
      this.helpers.onSnapshot(reflectionsRef, (snapshot) => {
        this.data.reflections = [];
        snapshot.forEach(doc => {
          this.data.reflections.push({ id: doc.id, ...doc.data() });
        });
        this.renderJournal();
        checkInitialLoad();
      })
    );

    // Group members (group mode only)
    if (this.scope === 'group') {
      const membersRef = this.collectionInScope('members');
      this.unsubscribers.push(
        this.helpers.onSnapshot(membersRef, (snapshot) => {
          const oldMembers = [...this.data.groupMembers];
          this.data.groupMembers = [];
          snapshot.forEach(doc => {
            this.data.groupMembers.push({ id: doc.id, ...doc.data() });
          });

          if (this.initialLoadComplete) {
            this.checkForNewMembers(oldMembers, this.data.groupMembers);
          }

          this.renderGroup();
          this.renderDashboard();
          checkInitialLoad();
        }, (error) => {
          console.error('Error listening to members:', error);
        })
      );
    } else {
      // Personal mode: no group members
      this.data.groupMembers = [];
      this.renderGroup();
      this.renderDashboard();
      checkInitialLoad();
    }
    
    // Update last active
    this.updateLastActive();
  }

  async updateLastActive() {
    if (!this.userKey || !this.userName) return;

    const payload = {
      name: this.userName,
      lastActive: new Date().toISOString()
    };

    if (this.scope === 'group' && this.groupCode) {
      await this.helpers.setDoc(
        this.helpers.doc(this.db, ...(this.getRootPath()), 'members', this.userKey),
        payload,
        { merge: true }
      );
    } else {
      await this.helpers.setDoc(
        this.helpers.doc(this.db, 'users', this.userKey),
        payload,
        { merge: true }
      );
    }
  }

  // =====================
  // GOALS
  // =====================

  async addGoal(title, description, assignee, dueDate, category) {
    const goalId = 'goal_' + Date.now();
    await this.helpers.setDoc(
      this.docInScope('goals', goalId),
      {
        title,
        description,
        assignee,
        dueDate,
        category,
        progress: 0,
        completed: false,
        createdBy: this.userName,
        createdAt: new Date().toISOString()
      }
    );

    // Update UI immediately; realtime listeners will reconcile state.
    const newGoal = {
      id: goalId,
      title,
      description,
      assignee,
      dueDate,
      category,
      progress: 0,
      completed: false,
      createdBy: this.userName,
      createdAt: new Date().toISOString()
    };
    this.data.goals = (this.data.goals || []).filter(g => g.id !== goalId);
    this.data.goals.unshift(newGoal);
    this.renderGoals();
    this.renderDashboard();

    this.showToast('Goal added! 🎯');
  }

  async updateGoalProgress(goalId, progress) {
    const completed = progress >= 100;
    await this.helpers.setDoc(
      this.docInScope('goals', goalId),
      { progress, completed, completedAt: completed ? new Date().toISOString() : null },
      { merge: true }
    );
    
    if (completed) {
      this.showToast('Goal completed! 🎉');
      const completedGoal = this.data.goals.find(g => g.id === goalId);
      const completedTitle = completedGoal ? completedGoal.title : '';
      this.addWin(`Completed goal: ${completedTitle}`, 'goal');
    }
  }

  async deleteGoal(goalId) {
    await this.helpers.deleteDoc(
      this.docInScope('goals', goalId)
    );
    this.showToast('Goal removed');
  }

  renderGoals() {
    // Separate goals by type (group vs personal)
    const groupGoals = this.data.goals.filter(g => !g.completed && ((g.assignee || '').toLowerCase() === 'group'));
    const personalGoals = this.data.goals.filter(g => !g.completed && ((g.assignee || '').toLowerCase() !== 'group'));
    
    // Render group goals
    const groupContainer = document.getElementById('groupGoals');
    if (groupContainer) {
      if (groupGoals.length === 0) {
        groupContainer.innerHTML = `<p class="empty-state">No group goals yet. Set a shared goal together!</p>`;
      } else {
        groupContainer.innerHTML = groupGoals.map(goal => this.renderGoalCard(goal)).join('');
        this.attachGoalEventListeners(groupContainer);
      }
    }
    
    // Render personal goals
    const personalContainer = document.getElementById('personalGoals');
    if (personalContainer) {
      if (personalGoals.length === 0) {
        personalContainer.innerHTML = `<p class="empty-state">No personal goals yet. What do you want to improve?</p>`;
      } else {
        personalContainer.innerHTML = personalGoals.map(goal => this.renderGoalCard(goal)).join('');
        this.attachGoalEventListeners(personalContainer);
      }
    }
  }
  
  renderGoalCard(goal) {
    const categoryKey = (goal.category === 'family') ? 'group' : (goal.category || 'personal');
    const categoryLabel = (categoryKey || '').toString();
    return `
      <div class="goal-card" data-id="${goal.id}">
        <div class="goal-header">
          <span class="goal-category ${categoryKey}">${this.getCategoryEmoji(categoryKey)} ${categoryLabel}</span>
          <span class="goal-assignee">👤 ${goal.assignee}</span>
        </div>
        <h3 class="goal-title">${goal.title}</h3>
        <p class="goal-description">${goal.description || ''}</p>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${goal.progress}%"></div>
          </div>
          <span class="progress-text">${goal.progress}%</span>
        </div>
        <div class="goal-actions">
          <input type="range" min="0" max="100" value="${goal.progress}" class="progress-slider" data-goal="${goal.id}">
          <button class="btn btn-small btn-danger" data-delete-goal="${goal.id}">🗑️</button>
        </div>
        ${goal.dueDate ? `<div class="goal-due">Due: ${new Date(goal.dueDate).toLocaleDateString()}</div>` : ''}
      </div>
    `;
  }
  
  attachGoalEventListeners(container) {
    container.querySelectorAll('.progress-slider').forEach(slider => {
      slider.addEventListener('change', (e) => {
        this.updateGoalProgress(e.target.dataset.goal, parseInt(e.target.value));
      });
    });
    
    container.querySelectorAll('[data-delete-goal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (confirm('Delete this goal?')) {
          this.deleteGoal(e.target.dataset.deleteGoal);
        }
      });
    });
  }

  getCategoryEmoji(category) {
    const emojis = {
      health: '💪',
      learning: '📚',
      family: '👥',
      group: '👥',
      home: '🏠',
      finance: '💰',
      fun: '🎉',
      personal: '🌟'
    };
    return emojis[category] || '🎯';
  }

  // =====================
  // HABITS
  // =====================

  async addHabit(name, frequency, assignee, reminder) {
    const habitId = 'habit_' + Date.now();
    const habitData = {
      name,
      frequency,
      assignee,
      streak: 0,
      completedDates: [],
      createdBy: this.userName,
      createdAt: new Date().toISOString()
    };
    
    // Only include reminder if it has a value (Firebase doesn't allow undefined)
    if (reminder) {
      habitData.reminder = reminder;
    }
    
    await this.helpers.setDoc(
      this.docInScope('habits', habitId),
      habitData
    );
    this.showToast('Habit added! 🌱');
  }

  async toggleHabitToday(habitId) {
    const habit = this.data.habits.find(h => h.id === habitId);
    if (!habit) return;
    
    const today = new Date().toISOString().split('T')[0];
    let completedDates = habit.completedDates || [];
    let streak = habit.streak || 0;
    
    if (completedDates.includes(today)) {
      completedDates = completedDates.filter(d => d !== today);
      streak = Math.max(0, streak - 1);
    } else {
      completedDates.push(today);
      streak = this.calculateStreak(completedDates);
      
      if (streak > 0 && streak % 7 === 0) {
        this.addWin(`${streak}-day streak on "${habit.name}"! 🔥`, 'habit');
      }
    }
    
    await this.helpers.setDoc(
      this.docInScope('habits', habitId),
      { completedDates, streak, lastCompleted: today },
      { merge: true }
    );
  }

  calculateStreak(dates) {
    if (!dates || dates.length === 0) return 0;
    
    const sortedDates = [...dates].sort().reverse();
    const today = new Date().toISOString().split('T')[0];
    
    if (sortedDates[0] !== today) return 0;
    
    let streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1]);
      const currDate = new Date(sortedDates[i]);
      const diffDays = (prevDate - currDate) / (1000 * 60 * 60 * 24);
      
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  async deleteHabit(habitId) {
    await this.helpers.deleteDoc(
      this.docInScope('habits', habitId)
    );
    this.showToast('Habit removed');
  }

  renderHabits() {
    const container = document.getElementById('habitsList');
    if (!container) return;
    
    if (this.data.habits.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🌱</div>
          <h3>No habits yet</h3>
          <p>Start building positive habits!</p>
        </div>
      `;
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    container.innerHTML = this.data.habits.map(habit => {
      const isCompletedToday = (habit.completedDates || []).includes(today);
      return `
        <div class="habit-card ${isCompletedToday ? 'completed' : ''}" data-id="${habit.id}">
          <button class="habit-check ${isCompletedToday ? 'checked' : ''}" data-toggle-habit="${habit.id}">
            ${isCompletedToday ? '✓' : ''}
          </button>
          <div class="habit-info">
            <h3 class="habit-name">${habit.name}</h3>
            <div class="habit-meta">
              <span>👤 ${habit.assignee}</span>
              <span>📅 ${habit.frequency}</span>
              <span class="habit-streak">🔥 ${habit.streak || 0} day streak</span>
            </div>
          </div>
          <button class="btn btn-small btn-danger" data-delete-habit="${habit.id}">🗑️</button>
        </div>
      `;
    }).join('');
    
    // Add event listeners
    container.querySelectorAll('[data-toggle-habit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.toggleHabitToday(e.target.dataset.toggleHabit);
      });
    });
    
    container.querySelectorAll('[data-delete-habit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (confirm('Delete this habit?')) {
          this.deleteHabit(e.target.dataset.deleteHabit);
        }
      });
    });
    
    // Render weekly habit grid
    this.renderWeeklyHabitGrid();
  }

  renderWeeklyHabitGrid() {
    const container = document.getElementById('weeklyHabitGrid');
    if (!container || this.data.habits.length === 0) {
      if (container) container.innerHTML = '<p class="empty-state">Add habits to see your weekly progress!</p>';
      return;
    }
    
    // Get last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      days.push({
        date: date.toISOString().split('T')[0],
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        isToday: i === 0
      });
    }
    
    container.innerHTML = `
      <div class="habit-grid-table">
        <div class="habit-grid-header">
          <div class="habit-grid-name">Habit</div>
          ${days.map(d => `<div class="habit-grid-day ${d.isToday ? 'today' : ''}">${d.label}</div>`).join('')}
        </div>
        ${this.data.habits.map(habit => `
          <div class="habit-grid-row">
            <div class="habit-grid-name">${habit.name}</div>
            ${days.map(d => {
              const completed = (habit.completedDates || []).includes(d.date);
              return `<div class="habit-grid-cell ${completed ? 'completed' : ''}">${completed ? '✓' : ''}</div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  // =====================
  // WINS & REFLECTIONS
  // =====================

  async addWin(description, type = 'general') {
    const winId = 'win_' + Date.now();
    await this.helpers.setDoc(
      this.docInScope('wins', winId),
      {
        description,
        type,
        member: this.userName,
        createdAt: new Date().toISOString()
      }
    );
  }

  async addReflection(content, mood) {
    const reflectionId = 'ref_' + Date.now();
    await this.helpers.setDoc(
      this.docInScope('reflections', reflectionId),
      {
        content,
        mood,
        member: this.userName,
        createdAt: new Date().toISOString()
      }
    );
    this.showToast('Reflection saved! 📝');
  }

  renderJournal() {
    // Render past reflections on Journal page
    const reflectionsContainer = document.getElementById('pastReflections');
    
    if (reflectionsContainer) {
      const recentReflections = this.data.reflections
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);
      
      if (recentReflections.length === 0) {
        reflectionsContainer.innerHTML = `<p class="empty-state">No reflections yet. Start your first one above!</p>`;
      } else {
        reflectionsContainer.innerHTML = recentReflections.map(ref => `
          <div class="reflection-item">
            <span class="mood-icon">${this.getMoodEmoji(ref.mood)}</span>
            <div class="reflection-content">
              <p>${ref.content}</p>
              <small>${ref.member} • ${this.formatDate(ref.createdAt)}</small>
            </div>
          </div>
        `).join('');
      }
    }
    
    // Render group/shared wins on Group page
    const groupWinsContainer = document.getElementById('groupWins');
    if (groupWinsContainer) {
      const recentWins = this.data.wins
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10);
      
      if (recentWins.length === 0) {
        groupWinsContainer.innerHTML = `<p class="empty-state">Log wins to celebrate progress!</p>`;
      } else {
        groupWinsContainer.innerHTML = recentWins.map(win => `
          <div class="win-item">
            <span class="win-icon">🏆</span>
            <div class="win-content">
              <p>${win.description}</p>
              <small>${win.member} • ${this.formatDate(win.createdAt)}</small>
            </div>
          </div>
        `).join('');
      }
    }
  }

  getMoodEmoji(mood) {
    const moods = {
      great: '😄',
      good: '🙂',
      okay: '😐',
      challenging: '😤',
      tough: '😢'
    };
    return moods[mood] || '🙂';
  }

  formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }

  // =====================
  // DASHBOARD
  // =====================

  renderDashboard() {
    // Update stats
    const activeGoals = this.data.goals.filter(g => !g.completed).length;
    const today = new Date().toISOString().split('T')[0];
    const habitsCompletedToday = this.data.habits.filter(h => 
      (h.completedDates || []).includes(today)
    ).length;
    const totalHabits = this.data.habits.length;
    const bestStreak = this.data.habits.length > 0 
      ? Math.max(...this.data.habits.map(h => h.streak || 0))
      : 0;
    const totalWins = this.data.wins.length;
    const memberCount = this.scope === 'group' ? (this.data.groupMembers || []).length : 0;
    
    // Update individual stat elements (matching the HTML IDs)
    const streakEl = document.getElementById('currentStreak');
    const habitsEl = document.getElementById('habitsCompleted');
    const winsEl = document.getElementById('totalWins');
    const membersEl = document.getElementById('groupMembersCount');
    
    if (streakEl) streakEl.textContent = bestStreak;
    if (habitsEl) habitsEl.textContent = `${habitsCompletedToday}/${totalHabits}`;
    if (winsEl) winsEl.textContent = totalWins;
    if (membersEl) membersEl.textContent = memberCount;
    
    // Update date
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', month: 'long', day: 'numeric' 
      });
    }
    
    // Recent wins on dashboard
    const recentWinsContainer = document.getElementById('recentWins');
    if (recentWinsContainer) {
      const recentWins = this.data.wins
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);
      
      if (recentWins.length === 0) {
        recentWinsContainer.innerHTML = `<p class="empty-state">No wins logged yet. Celebrate your first improvement!</p>`;
      } else {
        recentWinsContainer.innerHTML = recentWins.map(win => `
          <div class="win-item">
            <span class="win-icon">🏆</span>
            <div class="win-content">
              <p>${win.description}</p>
              <small>${win.member} • ${this.formatDate(win.createdAt)}</small>
            </div>
          </div>
        `).join('');
      }
    }
    
    // Load and display daily focus
    this.loadDailyFocus();
    
    // Update daily quote
    this.updateDailyQuote();
  }

  async loadDailyFocus() {
    const today = new Date().toISOString().split('T')[0];
    const focusInput = document.getElementById('dailyFocus');
    const focusDisplay = document.getElementById('focusDisplay');
    const focusText = focusDisplay ? focusDisplay.querySelector('.focus-text') : null;
    const inputContainer = document.querySelector('.focus-input-container');
    
    try {
      const focusDoc = await this.helpers.getDoc(
        this.docInScope('focus', today)
      );
      
      if (focusDoc.exists()) {
        const data = focusDoc.data();
        if (focusText) focusText.textContent = `"${data.focus}" — ${data.member}`;
        if (focusDisplay) focusDisplay.classList.remove('hidden');
        if (inputContainer) inputContainer.classList.add('hidden');
      }
    } catch (e) {
      // No focus set
    }
    
    // Edit focus button
    const editFocusBtn = document.getElementById('editFocus');
    if (editFocusBtn) editFocusBtn.addEventListener('click', () => {
      const focusDisplay = document.getElementById('focusDisplay');
      const inputContainer = document.querySelector('.focus-input-container');
      if (focusDisplay) focusDisplay.classList.add('hidden');
      if (inputContainer) inputContainer.classList.remove('hidden');
    });
  }

  updateDailyQuote() {
    const quotes = [
      { text: "A journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
      { text: "Small deeds done are better than great deeds planned.", author: "Peter Marshall" },
      { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
      { text: "Progress, not perfection.", author: "kaiZEN Proverb" },
      { text: "Better a little which is well done, than a great deal imperfectly.", author: "Plato" },
      { text: "Continuous improvement is better than delayed perfection.", author: "Mark Twain" },
      { text: "The man who moves a mountain begins by carrying away small stones.", author: "Confucius" },
      { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
      { text: "If you want to change the world, start with yourself.", author: "Mahatma Gandhi" },
      { text: "Excellence is not an act, but a habit.", author: "Aristotle" },
      { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
      { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
      { text: "Strive for progress, not perfection.", author: "Unknown" },
      { text: "Every accomplishment starts with the decision to try.", author: "John F. Kennedy" }
    ];
    
    // Use date to pick quote (same quote all day)
    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const quote = quotes[dayOfYear % quotes.length];
    
    const quoteEl = document.getElementById('dailyQuote');
    const authorEl = document.getElementById('quoteAuthor');
    
    if (quoteEl) quoteEl.textContent = `"${quote.text}"`;
    if (authorEl) authorEl.textContent = `— ${quote.author}`;
  }

  // =====================
  // GROUP
  // =====================

  renderGroup() {
    const container = document.getElementById('groupMembersList');
    if (!container) return;

    const groupCodeDisplay = document.getElementById('groupCodeDisplay');
    if (groupCodeDisplay) {
      groupCodeDisplay.textContent = (this.scope === 'group' && this.groupCode) ? this.groupCode : '---';
    }

    const currentMemberDisplay = document.getElementById('currentMember');
    if (currentMemberDisplay) {
      currentMemberDisplay.textContent = this.userName || '---';
    }

    const members = this.data.groupMembers || [];
    if (members.length === 0) {
      container.innerHTML = this.scope === 'group'
        ? `<p class="empty-state">No group members found yet.</p>`
        : `<p class="empty-state">You're in personal mode. Join or create a group to see members here.</p>`;
      return;
    }

    const anyCreator = members.some(m => !!m.isCreator);
    const currentUserIsCreator = members.some(m => (m.id === this.userKey) && !!m.isCreator);
    const canManageMembers = this.scope === 'group' && (currentUserIsCreator || !anyCreator);

    container.innerHTML = members.map(member => {
      const memberKey = member.id || this.normalizeKey(member.name);
      const isCurrentUser = memberKey === this.userKey;

      const showRemoveBtn = canManageMembers && !isCurrentUser && !member.isCreator;

      return `
        <div class="member-card ${isCurrentUser ? 'current' : ''}" data-member-id="${member.id}">
          <div class="member-avatar">${member.name ? member.name.charAt(0).toUpperCase() : '?'}</div>
          <div class="member-info">
            <h4>${member.name || 'Unknown'} ${isCurrentUser ? '(You)' : ''}</h4>
            <small>Last active: ${member.lastActive ? this.formatDate(member.lastActive) : 'Never'}</small>
          </div>
          ${member.isCreator ? '<span class="member-badge">👑 Creator</span>' : ''}
          ${showRemoveBtn ? `<button class="btn btn-small btn-danger member-remove" data-remove-member="${member.id}" data-member-name="${member.name}" title="Remove ${member.name}">✕</button>` : ''}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.member-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.currentTarget;
        const memberId = button.dataset.removeMember;
        const memberName = button.dataset.memberName;
        if (!memberId) return;

        if (confirm(`Remove ${memberName} from the group?`)) {
          await this.removeGroupMember(memberId, memberName);
        }
      });
    });
  }

  async removeGroupMember(memberId, memberName) {
    if (this.scope !== 'group' || !this.groupCode) return;
    try {
      await this.helpers.deleteDoc(
        this.helpers.doc(this.db, ...(this.getRootPath()), 'members', memberId)
      );

      this.showToast(`${memberName} has been removed`);
    } catch (error) {
      console.error('Error removing member:', error);
      this.showToast('Failed to remove member');
    }
  }

  // =====================
  // NAVIGATION & UI
  // =====================

  setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');

    const allowedPages = new Set(['dashboard', 'goals', 'habits', 'journal', 'group', 'learn', 'donate']);

    const showPage = (targetPage) => {
      const pageKey = allowedPages.has(targetPage) ? targetPage : 'dashboard';

      navLinks.forEach(l => l.classList.remove('active'));
      const activeLink = document.querySelector(`.nav-link[data-page="${pageKey}"]`);
      if (activeLink) activeLink.classList.add('active');

      pages.forEach(p => {
        p.classList.toggle('active', p.id === `page-${pageKey}`);
      });

      // Trigger re-renders for specific pages to ensure data is fresh
      if (pageKey === 'group') {
        this.renderGroup();
      } else if (pageKey === 'journal') {
        this.renderJournal();
      }

      if (navMenu) navMenu.classList.remove('active');
    };

    const routeFromHash = () => {
      const hash = (window.location.hash || '').replace('#', '').trim();
      if (!hash) return;
      showPage(hash);
    };
    
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetPage = link.dataset.page;
        if (targetPage) {
          window.location.hash = `#${targetPage}`;
          showPage(targetPage);
        }
      });
    });
    
    if (navToggle) {
      navToggle.addEventListener('click', () => {
        if (navMenu) navMenu.classList.toggle('active');
      });
    }

    // Support back/forward navigation and direct linking
    window.addEventListener('hashchange', routeFromHash);
    routeFromHash();
  }

  setupEventListeners() {
    // Add Goal buttons
    const addGroupGoalBtn = document.getElementById('addGroupGoal');
    if (addGroupGoalBtn) addGroupGoalBtn.addEventListener('click', () => this.openGoalModal('group'));
    const addPersonalGoalBtn = document.getElementById('addPersonalGoal');
    if (addPersonalGoalBtn) addPersonalGoalBtn.addEventListener('click', () => this.openGoalModal('personal'));
    
    // Add Habit button
    const addHabitBtn = document.getElementById('addHabit');
    if (addHabitBtn) addHabitBtn.addEventListener('click', () => this.openModal('addHabitModal'));
    
    // Quick Actions
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        switch(action) {
          case 'addWin':
            this.openModal('addWinModal');
            break;
          case 'addReflection':
            this.openModal('addReflectionModal');
            break;
          case 'viewHabits':
            const habitsLink = document.querySelector('[data-page="habits"]');
            if (habitsLink) habitsLink.click();
            break;
          case 'groupMeeting':
            this.openModal('meetingTimerOverlay');
            break;
        }
      });
    });
    
    // Start Meeting button
    const startMeetingBtn = document.getElementById('startMeeting');
    if (startMeetingBtn) startMeetingBtn.addEventListener('click', () => this.openModal('meetingTimerOverlay'));

    // Group page quick actions
    const openJoinGroupBtn = document.getElementById('openJoinGroup');
    if (openJoinGroupBtn) openJoinGroupBtn.addEventListener('click', () => this.openSetupTab('join'));
    const openCreateGroupBtn = document.getElementById('openCreateGroup');
    if (openCreateGroupBtn) openCreateGroupBtn.addEventListener('click', () => this.openSetupTab('create'));
    
    // Add Goal Form
    const addGoalForm = document.getElementById('addGoalForm');
    if (addGoalForm) addGoalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.db || !this.helpers) {
        this.showToast('Still loading… If this persists, refresh and disable blockers.');
        return;
      }
      const form = e.target;
      await this.addGoal(
        form.goalTitle.value,
        form.goalDescription.value,
        form.goalAssignee.value || this.userName,
        form.goalDueDate.value,
        form.goalCategory.value
      );
      form.reset();
      this.closeModal('addGoalModal');
    });
    
    // Add Habit Form
    const addHabitForm = document.getElementById('addHabitForm');
    if (addHabitForm) addHabitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.db || !this.helpers) {
        this.showToast('Still loading… If this persists, refresh and disable blockers.');
        return;
      }
      const form = e.target;
      const reminderValue = form.habitReminder ? form.habitReminder.value : undefined;
      await this.addHabit(
        form.habitName.value,
        form.habitFrequency.value,
        form.habitAssignee.value || this.userName,
        reminderValue
      );
      form.reset();
      this.closeModal('addHabitModal');
    });
    
    // Add Win Form
    const addWinForm = document.getElementById('addWinForm');
    if (addWinForm) addWinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.db || !this.helpers) {
        this.showToast('Still loading… If this persists, refresh and disable blockers.');
        return;
      }
      const form = e.target;
      await this.addWin(form.winDescription.value);
      form.reset();
      this.closeModal('addWinModal');
      this.showToast('Win celebrated! 🎉');
    });
    
    // Add Reflection Form
    const addReflectionForm = document.getElementById('addReflectionForm');
    if (addReflectionForm) addReflectionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.db || !this.helpers) {
        this.showToast('Still loading… If this persists, refresh and disable blockers.');
        return;
      }
      const form = e.target;
      await this.addReflection(form.reflectionContent.value, form.reflectionMood.value);
      form.reset();
      this.closeModal('addReflectionModal');
    });
    
    // Journal page reflection form
    const reflectionForm = document.getElementById('reflectionForm');
    if (reflectionForm) reflectionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.db || !this.helpers) {
        this.showToast('Still loading… If this persists, refresh and disable blockers.');
        return;
      }
      const form = e.target;
      const content = [
        (form.reflectionWin && form.reflectionWin.value) ? `🌟 Win: ${form.reflectionWin.value}` : '',
        (form.reflectionLearn && form.reflectionLearn.value) ? `📚 Learned: ${form.reflectionLearn.value}` : '',
        (form.reflectionImprove && form.reflectionImprove.value) ? `🎯 Improve: ${form.reflectionImprove.value}` : '',
        (form.reflectionGratitude && form.reflectionGratitude.value) ? `💝 Grateful: ${form.reflectionGratitude.value}` : ''
      ].filter(Boolean).join('\n');
      
      if (content) {
        await this.addReflection(content, 'good');
        form.reset();
        this.showToast('Reflection saved! 📝');
      }
    });
    
    // Daily Focus
    const saveFocusBtn = document.getElementById('saveFocus');
    const dailyFocusInput = document.getElementById('dailyFocus');
    if (saveFocusBtn) saveFocusBtn.addEventListener('click', async () => {
      const focus = (dailyFocusInput && dailyFocusInput.value) ? dailyFocusInput.value.trim() : '';
      if (focus) {
        await this.saveDailyFocus(focus);
        this.showToast('Focus set! 🎯');
      }
    });
    
    // Modal close buttons - close on X click
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modal = btn.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });
    
    // Close modal on overlay click (but not modal content click)
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });
    
    // Close meeting timer
    const closeMeetingTimerBtn = document.getElementById('closeMeetingTimer');
    if (closeMeetingTimerBtn) closeMeetingTimerBtn.addEventListener('click', () => {
      this.closeModal('meetingTimerOverlay');
    });
    
    // Copy group code
    const copyCodeBtn = document.getElementById('copyGroupCode');
    if (copyCodeBtn) copyCodeBtn.addEventListener('click', () => {
      if (this.scope !== 'group' || !this.groupCode) {
        this.showToast('No group code yet. Join or create a group first.');
        return;
      }
      navigator.clipboard.writeText(this.groupCode);
      this.showToast('Group code copied!');
    });
    
    // Leave group (returns to personal mode)
    const leaveGroupBtn = document.getElementById('leaveGroup');
    if (leaveGroupBtn) leaveGroupBtn.addEventListener('click', () => {
      const message = (this.scope === 'group' && this.groupCode)
        ? 'Leave this group? Your personal data will remain on this device.'
        : 'Switch to personal mode? (This clears any saved group code on this device.)';

      if (!confirm(message)) return;

      localStorage.removeItem('kaizen_group_code');
      localStorage.removeItem('kaizen_group_root');
      this.groupCode = null;
      this.groupRoot = null;
      this.scope = 'personal';

      // Reset listeners into personal mode
      this.setupRealtimeListeners();
      this.renderDashboard();
      this.renderGroup();
    });
    
    // Learn page navigation tabs
    document.querySelectorAll('.learn-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        
        // Update active tab
        document.querySelectorAll('.learn-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show corresponding section
        document.querySelectorAll('.learn-section').forEach(s => s.classList.remove('active'));
        const targetSection = document.getElementById(`learn-${section}`);
        if (targetSection) targetSection.classList.add('active');
      });
    });
  }
  
  async saveDailyFocus(focus) {
    const today = new Date().toISOString().split('T')[0];
    await this.helpers.setDoc(
      this.docInScope('focus', today),
      {
        focus,
        member: this.userName,
        createdAt: new Date().toISOString()
      }
    );
  }

  openGoalModal(type) {
    const assigneeInput = document.getElementById('goalAssignee');
    if (assigneeInput) {
      if (type === 'group') {
        assigneeInput.value = 'Group';
        assigneeInput.placeholder = 'Group (shared goal)';
      } else {
        assigneeInput.value = this.userName || '';
        assigneeInput.placeholder = 'Your name';
      }
    }
    this.openModal('addGoalModal');
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  showToast(message) {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // =====================
  // MEETING TIMER
  // =====================

  setupMeetingTimer() {
    this.timerPhases = [
      { name: 'Wins & Gratitude', duration: 300, description: 'Share wins and what you\'re grateful for' },
      { name: 'Goal Review', duration: 300, description: 'Review progress on current goals' },
      { name: 'Challenges', duration: 300, description: 'Discuss any challenges and brainstorm solutions' },
      { name: 'Planning', duration: 300, description: 'Set intentions for the week ahead' },
      { name: 'Appreciation', duration: 180, description: 'Express appreciation for each other' }
    ];
    
    this.currentPhase = 0;
    this.timerRunning = false;
    this.timerSeconds = this.timerPhases[0].duration;
    
    const timerToggle = document.getElementById('timerToggle');
    const timerPrev = document.getElementById('timerPrev');
    const timerNext = document.getElementById('timerNext');
    
    if (timerToggle) timerToggle.addEventListener('click', () => this.toggleTimer());
    if (timerPrev) timerPrev.addEventListener('click', () => this.prevPhase());
    if (timerNext) timerNext.addEventListener('click', () => this.nextPhase());
    
    this.updateTimerDisplay();
  }

  toggleTimer() {
    this.timerRunning = !this.timerRunning;
    const btn = document.getElementById('timerToggle');
    btn.textContent = this.timerRunning ? 'Pause' : 'Start';
    
    if (this.timerRunning) {
      this.timerInterval = setInterval(() => this.tickTimer(), 1000);
    } else {
      clearInterval(this.timerInterval);
    }
  }

  tickTimer() {
    this.timerSeconds--;
    this.updateTimerDisplay();
    
    if (this.timerSeconds <= 0) {
      this.nextPhase();
    }
  }

  nextPhase() {
    if (this.currentPhase < this.timerPhases.length - 1) {
      this.currentPhase++;
      this.timerSeconds = this.timerPhases[this.currentPhase].duration;
      this.updateTimerDisplay();
    } else {
      this.timerRunning = false;
      clearInterval(this.timerInterval);
      document.getElementById('timerToggle').textContent = 'Start';
      this.showToast('Meeting complete! Great job! 🎉');
    }
  }

  prevPhase() {
    if (this.currentPhase > 0) {
      this.currentPhase--;
      this.timerSeconds = this.timerPhases[this.currentPhase].duration;
      this.updateTimerDisplay();
    }
  }

  updateTimerDisplay() {
    const phase = this.timerPhases[this.currentPhase];
    const minutes = Math.floor(this.timerSeconds / 60);
    const seconds = this.timerSeconds % 60;
    
    // Match the HTML element IDs
    const timerTime = document.getElementById('timerTime');
    const timerStep = document.getElementById('timerStep');
    const timerProgress = document.getElementById('timerProgress');
    
    if (timerTime) timerTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (timerStep) timerStep.textContent = phase.name;
    
    // Update progress bar
    if (timerProgress) {
      const progress = ((phase.duration - this.timerSeconds) / phase.duration) * 100;
      timerProgress.style.width = `${progress}%`;
    }
  }

  // =====================
  // NOTIFICATIONS
  // =====================

  async setupNotifications() {
    // Check if notifications are supported
    if (!('Notification' in window)) {
      console.log('Notifications not supported');
      return;
    }

    // Update UI based on current permission
    this.updateNotificationUI();
    
    // Set up notification toggle button
    const notifToggle = document.getElementById('notificationToggle');
    if (notifToggle) notifToggle.addEventListener('click', () => this.toggleNotifications());
    
    // Set up reminder time input
    const reminderTimeInput = document.getElementById('reminderTime');
    const savedTime = localStorage.getItem('kaizen_reminder_time') || '19:00';
    if (reminderTimeInput) reminderTimeInput.value = savedTime;
    
    const saveReminderBtn = document.getElementById('saveReminderTime');
    if (saveReminderBtn) saveReminderBtn.addEventListener('click', () => {
      const newTime = (reminderTimeInput && reminderTimeInput.value) ? reminderTimeInput.value : '19:00';
      localStorage.setItem('kaizen_reminder_time', newTime);
      this.scheduleNextReminder();
      this.showToast(`Reminder set for ${newTime}! ⏰`);
    });
    
    // Check for scheduled reminders
    this.checkScheduledReminders();
  }

  updateNotificationUI() {
    const notifToggle = document.getElementById('notificationToggle');
    const notifStatus = document.getElementById('notificationStatus');
    
    if (!notifToggle) return;
    
    const permission = Notification.permission;
    const enabled = localStorage.getItem('kaizen_notifications') === 'true';
    
    if (permission === 'granted' && enabled) {
      notifToggle.textContent = '🔔 Notifications On';
      notifToggle.classList.add('active');
      if (notifStatus) notifStatus.textContent = 'You\'ll receive daily reminders';
    } else if (permission === 'denied') {
      notifToggle.textContent = '🔕 Notifications Blocked';
      notifToggle.disabled = true;
      if (notifStatus) notifStatus.textContent = 'Enable in browser settings';
    } else {
      notifToggle.textContent = '🔔 Enable Notifications';
      notifToggle.classList.remove('active');
      if (notifStatus) notifStatus.textContent = 'Get daily reminders';
    }
  }

  async toggleNotifications() {
    const permission = Notification.permission;
    
    if (permission === 'denied') {
      this.showToast('Please enable notifications in your browser settings');
      return;
    }
    
    if (permission === 'default') {
      // Request permission
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        localStorage.setItem('kaizen_notifications', 'true');
        this.scheduleReminders();
        this.showToast('Notifications enabled! 🔔');
        // Send a test notification
        this.sendTestNotification();
      } else {
        this.showToast('Notifications were not enabled');
      }
    } else if (permission === 'granted') {
      // Toggle on/off
      const currentlyEnabled = localStorage.getItem('kaizen_notifications') === 'true';
      if (currentlyEnabled) {
        localStorage.setItem('kaizen_notifications', 'false');
        this.showToast('Notifications disabled');
      } else {
        localStorage.setItem('kaizen_notifications', 'true');
        this.scheduleReminders();
        this.showToast('Notifications enabled! 🔔');
      }
    }
    
    this.updateNotificationUI();
  }

  sendTestNotification() {
    if (Notification.permission !== 'granted') return;
    
    new Notification('kaiZEN', {
      body: 'Notifications are working! You\'ll get daily reminders.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png'
    });
  }

  scheduleReminders() {
    // Store reminder preferences
    const reminderTime = localStorage.getItem('kaizen_reminder_time') || '19:00';
    localStorage.setItem('kaizen_reminder_time', reminderTime);
    
    // Schedule next reminder
    this.scheduleNextReminder();
  }

  scheduleNextReminder() {
    if (localStorage.getItem('kaizen_notifications') !== 'true') return;
    if (Notification.permission !== 'granted') return;
    
    const reminderTime = localStorage.getItem('kaizen_reminder_time') || '19:00';
    const [hours, minutes] = reminderTime.split(':').map(Number);
    
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);
    
    // If time has passed today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }
    
    const delay = scheduledTime.getTime() - now.getTime();
    
    // Use service worker for background notifications if available
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SCHEDULE_NOTIFICATION',
        title: 'kaiZEN',
        body: this.getRandomReminderMessage(),
        delay: delay
      });
    }
    
    // Also set a timeout as backup (only works while app is open)
    setTimeout(() => {
      this.showReminderNotification();
      // Schedule the next one
      this.scheduleNextReminder();
    }, delay);
  }

  getRandomReminderMessage() {
    const messages = [
      'Time for your daily reflection! What went well today?',
      'Quick check-in: Did you make progress on your goals?',
      'kaiZEN moment: What small improvement can you celebrate?',
      'Daily reminder: Log your wins and reflections!',
      'How was your day? Take a moment to reflect.',
      'Don\'t forget to check off your habits!',
      'Small steps, big results! How did you improve today?',
      'Time for your 1% better check-in!',
      'End your day with gratitude. What are you thankful for?',
      'kaiZEN time! Review your progress and plan tomorrow.'
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  showReminderNotification() {
    if (Notification.permission !== 'granted') return;
    if (localStorage.getItem('kaizen_notifications') !== 'true') return;
    
    new Notification('kaiZEN', {
      body: this.getRandomReminderMessage(),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: 'kaizen-daily-reminder',
      renotify: true
    });
  }

  checkScheduledReminders() {
    // Re-schedule reminders when app loads
    if (localStorage.getItem('kaizen_notifications') === 'true') {
      this.scheduleNextReminder();
    }
  }

  // =====================
  // GROUP ACTIVITY NOTIFICATIONS
  // =====================

  checkForNewWins(oldWins, newWins) {
    if (localStorage.getItem('kaizen_notifications') !== 'true') return;
    if (this.scope !== 'group') return;
    
    // Find wins that are new (not in old list)
    const oldIds = new Set(oldWins.map(w => w.id));
    const addedWins = newWins.filter(w => !oldIds.has(w.id));
    
    // Notify about wins from OTHER group members
    addedWins.forEach(win => {
      if (win.member && win.member !== this.userName) {
        this.showGroupNotification(
          `🏆 ${win.member} logged a win!`,
          win.description || 'Check out their achievement!'
        );
        this.showInAppNotification(`🏆 ${win.member} logged a win!`, win.description);
      }
    });
  }

  checkForHabitChanges(oldHabits, newHabits) {
    if (localStorage.getItem('kaizen_notifications') !== 'true') return;
    if (this.scope !== 'group') return;
    
    const today = new Date().toISOString().split('T')[0];
    
    newHabits.forEach(newHabit => {
      const oldHabit = oldHabits.find(h => h.id === newHabit.id);
      if (!oldHabit) return;
      
      const wasCompletedToday = (oldHabit.completedDates || []).includes(today);
      const isCompletedToday = (newHabit.completedDates || []).includes(today);
      
      // Someone just completed a habit
      if (!wasCompletedToday && isCompletedToday && newHabit.assignee !== this.userName) {
        this.showGroupNotification(
          `✅ ${newHabit.assignee} completed a habit!`,
          `"${newHabit.name}" - Keep up the great work!`
        );
        this.showInAppNotification(`✅ ${newHabit.assignee} completed "${newHabit.name}"!`);
      }
      
      // Check for streak milestones (5, 7, 10, 14, 21, 30, etc.)
      const milestones = [5, 7, 10, 14, 21, 30, 50, 100];
      if (newHabit.streak && newHabit.assignee !== this.userName) {
        const oldStreak = oldHabit.streak || 0;
        milestones.forEach(milestone => {
          if (oldStreak < milestone && newHabit.streak >= milestone) {
            this.showGroupNotification(
              `🔥 ${newHabit.assignee} hit a ${milestone}-day streak!`,
              `"${newHabit.name}" - Amazing consistency!`
            );
            this.showInAppNotification(`🔥 ${newHabit.assignee} hit a ${milestone}-day streak on "${newHabit.name}"!`);
          }
        });
      }
    });
  }

  checkForGoalChanges(oldGoals, newGoals) {
    if (localStorage.getItem('kaizen_notifications') !== 'true') return;
    if (this.scope !== 'group') return;
    
    // Check for new goals
    const oldIds = new Set(oldGoals.map(g => g.id));
    const addedGoals = newGoals.filter(g => !oldIds.has(g.id));
    
    addedGoals.forEach(goal => {
      if (goal.createdBy && goal.createdBy !== this.userName) {
        this.showGroupNotification(
          `🎯 ${goal.createdBy} added a new goal!`,
          goal.title
        );
        this.showInAppNotification(`🎯 ${goal.createdBy} added a goal: "${goal.title}"`);
      }
    });
    
    // Check for completed goals (progress went to 100%)
    newGoals.forEach(newGoal => {
      const oldGoal = oldGoals.find(g => g.id === newGoal.id);
      if (!oldGoal) return;
      
      if (oldGoal.progress < 100 && newGoal.progress >= 100) {
        const achiever = newGoal.assignee || newGoal.createdBy || 'Someone';
        if (achiever !== this.userName) {
          this.showGroupNotification(
            `🎉 ${achiever} completed a goal!`,
            `"${newGoal.title}" - Celebrate with them!`
          );
          this.showInAppNotification(`🎉 ${achiever} completed their goal: "${newGoal.title}"!`);
        }
      }
    });
  }

  checkForNewMembers(oldMembers, newMembers) {
    if (localStorage.getItem('kaizen_notifications') !== 'true') return;
    if (this.scope !== 'group') return;
    
    const oldIds = new Set(oldMembers.map(m => m.id));
    const addedMembers = newMembers.filter(m => !oldIds.has(m.id));
    
    addedMembers.forEach(member => {
      if (member.name && member.name !== this.userName) {
        this.showGroupNotification(
          `👋 ${member.name} joined the group!`,
          'Welcome them to your kaiZEN journey!'
        );
        this.showInAppNotification(`👋 ${member.name} joined the group!`, 'Welcome them!');
      }
    });
  }

  showGroupNotification(title, body) {
    if (Notification.permission !== 'granted') return;
    if (document.hasFocus()) return; // Don't show if app is focused
    
    new Notification(title, {
      body: body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: 'kaizen-group-activity',
      renotify: true
    });
  }

  showInAppNotification(title, body = '') {
    // Show an in-app toast notification
    const notification = document.createElement('div');
    notification.className = 'in-app-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <strong>${title}</strong>
        ${body ? `<p>${body}</p>` : ''}
      </div>
      <button class="notification-close">&times;</button>
    `;
    
    notification.querySelector('.notification-close').addEventListener('click', () => {
      notification.classList.add('hiding');
      setTimeout(() => notification.remove(), 300);
    });
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.classList.add('hiding');
        setTimeout(() => notification.remove(), 300);
      }
    }, 5000);
  }
}

// Toggle collapse for Learn page sections
function toggleCollapse(element) {
  element.classList.toggle('collapsed');
}

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  window.kaizen = new KaizenApp();
});
