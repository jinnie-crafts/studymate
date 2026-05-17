# Graph Report - C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate  (2026-05-17)

## Corpus Check
- 21 files · ~140,426 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 335 nodes · 655 edges · 26 communities detected
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 23 edges
2. `renderMessages()` - 17 edges
3. `generateAssistantReply()` - 17 edges
4. `renderHistory()` - 14 edges
5. `initializeGuestDashboard()` - 13 edges
6. `handleSendMessage()` - 13 edges
7. `syncHeaderWithActiveChat()` - 12 edges
8. `handleNewChat()` - 11 edges
9. `initNotifications()` - 11 edges
10. `test()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `initNotifications()` --calls--> `subscribeToNotifications()`  [INFERRED]
  C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\notificationBell.js → C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\services\notificationService.js
- `handleSubmit()` --calls--> `sendAdminNotification()`  [INFERRED]
  C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\admin.js → C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\services\notificationService.js
- `validateSignupEmail()` --calls--> `validateEmail()`  [INFERRED]
  C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\app.js → C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\disposableEmailValidator.js
- `startDashboardApp()` --calls--> `initNotifications()`  [INFERRED]
  C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\app.js → C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\notificationBell.js
- `renderMessages()` --calls--> `test()`  [INFERRED]
  C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\app.js → C:\Users\vrs_r\OneDrive\Desktop\websites-source-codes\studymate\scratch\test_openrouter.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (35): admin.css, admin.html, admin.js, agents.js, app.js, debounce.io, disposableEmailValidator.js, DuckDuckGo (+27 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (21): fetchWithRetry(), buildContextLayer(), buildPrompt(), collectDuckDuckGoSources(), dedupeSources(), detectIntent(), fetchNewsData(), fetchRealtimeContext() (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (20): classify(), result(), formatContext(), getCategoryLabel(), sanitizeUrl(), execute(), getCachedResult(), normalizeCacheKey() (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (10): AgentRunner, IdentityAgent, IntentAgent, MemoryAgent, QuizAgent, UIAgent, extractMemory(), formatMemoryPrompt() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (15): bindEvents(), escapeHtml(), getErrorMessage(), handleSubmit(), setLoading(), setupUI(), showToast(), updateCounters() (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (8): getMessageActionIcon(), isLatestAiMessage(), renderMessageActions(), resetPreferences(), saveDefaultMode(), saveDefaultNotesMode(), saveHinglishDefault(), setTheme()

### Community 6 - "Community 6"
Cohesion: 0.2
Nodes (18): bindStaticEvents(), clearFirstSnapshotTimeout(), clearUI(), closePanel(), escapeHtml(), getFriendlyNotificationErrorMessage(), handleUpdate(), initNotifications() (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (17): bindOnboardingStartButton(), getLocalWelcomeSeen(), getWelcomeSeenStorageKey(), handleStart(), hideOnboardingOverlay(), incrementStudyTracker(), initWelcomeModalBindings(), loadTrackerData() (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (15): cleanupChatSubscription(), clearCurrentUserChats(), confirmLogoutAll(), copyMessageContent(), exportUserData(), handleDeleteAccount(), handleLogout(), handlePasswordResetRequest() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.32
Nodes (14): closeGuestLimitModal(), createGuestChatDocument(), getSavedDefaultMode(), getSavedDefaultNotesMode(), getSavedHinglishDefault(), handleNewChat(), initializeGuestDashboard(), loadGuestQuestionUsage() (+6 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (14): applySavedTheme(), bindDashboardEvents(), bindModeDropdown(), bindNotesDropdown(), bindSettingsEvents(), bootstrap(), consumeFlashToast(), getSavedTheme() (+6 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (13): applyFontSize(), closeEditNameModal(), displayUserProfile(), ensureUserDocument(), getShortName(), initApp(), loadUsageStats(), loadUserMemory() (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.24
Nodes (11): delay(), escapeHtml(), focusMessageEditor(), formatMessage(), generateSafeFallbackReply(), getLatestUserMessageFromPayload(), renderMermaidDiagrams(), renderMessages() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (11): createGuestMessage(), fetchAIResponse(), generateAssistantReply(), generateChatTitle(), getSelectedMode(), getSelectedNotesMode(), normalizeSources(), renderMessageSources() (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (8): validateSignupEmail(), checkLocalDisposable(), checkRemoteDisposable(), extractDomain(), isDisposableEmailSync(), logBlockedAttempt(), maskEmail(), validateEmail()

### Community 15 - "Community 15"
Cohesion: 0.31
Nodes (9): autoResizeTextarea(), findPreviousUserMessageIndex(), getCurrentChat(), handleSendMessage(), incrementGuestQuestionUsage(), isGuestUsageLimitReached(), regenerateAiMessage(), saveGuestQuestionUsage() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.32
Nodes (8): closeSidebar(), createNewChatDocument(), getCurrentUserId(), loadChats(), loadMessages(), openChat(), stopStreamingResponse(), syncStateWithLatestChats()

### Community 17 - "Community 17"
Cohesion: 0.38
Nodes (7): cancelRename(), deleteChat(), focusRenameInput(), getChatById(), renderHistory(), saveRename(), startRename()

### Community 18 - "Community 18"
Cohesion: 0.43
Nodes (4): showError(), showForm(), showLoading(), verifyResetCode()

### Community 19 - "Community 19"
Cohesion: 0.83
Nodes (3): handleRecovery(), showError(), showSuccess()

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (2): checkVerification(), showVerifySuccess()

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): privacy.html

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): terms.html

## Knowledge Gaps
- **Thin community `Community 21`** (2 nodes): `setAdmin.js`, `setAdminRole()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `firebase.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `privacy.html`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `terms.html`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `test()` connect `Community 2` to `Community 1`, `Community 3`, `Community 12`?**
  _High betweenness centrality (0.236) - this node is a cross-community bridge._
- **Why does `renderMessages()` connect `Community 12` to `Community 2`, `Community 5`, `Community 9`, `Community 13`, `Community 15`, `Community 16`, `Community 17`?**
  _High betweenness centrality (0.194) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._