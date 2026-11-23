# SPDX-License-Identifier: AGPL-3.0-or-later

skip-to-content = Skip to content
nav-label = Main navigation
nav-index = Board index
nav-search = Search
nav-members = Members

welcome-title = Welcome to { $board }
welcome-body = This board is brand new. Forums, topics and posts arrive in the next milestone.

posts-count = { $count ->
    [one] { $count } post
   *[other] { $count } posts
}

footer-powered = Powered by { $product } { $version }
footer-source = Source code
footer-licence = Licensed under the GNU AGPL v3
language-label = Language
theme-label = Theme
theme-board-default = Board default
colour-scheme-label = Colour scheme
setting-core-board-defaultTheme = Default theme
theme-light = Light
theme-dark = Dark
theme-system = System

bb-you-guest = guest
bb-hidden-content = This content is hidden.

guest = Guest
by-author = by { $name }
breadcrumb-label = You are here
board-empty = This board has no forums yet. Run “postmodem seed-demo” to fill it with demo content.

index-forum = Forum
index-topics = Topics
index-posts = Posts
index-last-post = Last post
index-no-posts = No posts
index-restricted = Restricted: you cannot read this forum
index-subforums = Sub-forums
index-locked = (locked)

topics-count = { $count ->
    [one] { $count } topic
   *[other] { $count } topics
}
users-count = { $count ->
    [one] { $count } registered user
   *[other] { $count } registered users
}
stats-heading = Statistics
stats-totals = Our users have written { $posts } in { $topics }. We have { $users }.
stats-newest-label = Newest member:
stats-online = Signed in during the last { $minutes } minutes: { $count }

forum-topic = Topic
forum-author = Author
forum-replies = Replies
forum-views = Views
forum-no-topics = There are no topics in this forum yet.
forum-category-hint = Choose a forum:

topic-announcement = Announcement
topic-sticky = Sticky
topic-locked = Locked
topic-moved = Moved

pagination-label = Pages
pagination-status = Page { $current } of { $total }
pagination-prev = Previous
pagination-next = Next
pagination-goto = Page { $n }

post-permalink = Link to this post
post-author-posts = Posts: { $count }
post-author-joined = Joined
post-author-from = From
post-guest = guest

## Error pages
error-404-title = Page not found
error-404-body = This forum, topic or post does not exist, or you are not allowed to see it.
error-403-title = Access denied
error-403-body = You can see this forum exists, but you are not allowed to read it. Signing in may help.
error-other-title = Something went wrong
error-other-body = The board could not show this page. Please try again in a moment.
error-back = Back to the board index

## Accounts
signed-in-as = Signed in as { $name }
login-link = Sign in
register-link = Register
logout = Sign out
logout-everywhere = Sign out on all devices
logout-everywhere-hint = { $count ->
    [0] You are not signed in anywhere else.
    [one] You are also signed in on one other device.
   *[other] You are also signed in on { $count } other devices.
}
login-title = Sign in
login-signed-in-as = You are signed in as { $name }.
login-name = Username or e-mail address
login-password = Password
login-submit = Sign in
login-no-account = No account yet?
login-error-invalid = That username or password is not right.
login-error-inactive = This account can’t sign in right now. Contact the board’s administrators if you think that’s a mistake.
login-error-throttled = Too many attempts. Please wait { $seconds ->
    [one] one second
   *[other] { $seconds } seconds
} and try again.
register-title = Register
register-username = Username
register-username-hint = 2 to 25 letters or digits; spaces, dots, hyphens and underscores between them are fine.
register-email = E-mail address
register-email-hint = Used to sign in and to reset your password. Never shown to other users.
register-password = Password
register-password-hint = At least 10 characters. A few unrelated words make a strong password.
register-rules = Board rules
register-accept-rules = I have read and accept the board rules
register-submit = Create account
register-have-account = Already registered?
register-error-throttled = Too many registrations from your network. Please try again in { $minutes ->
    [one] a minute
   *[other] { $minutes } minutes
}.
register-welcome = Welcome aboard, { $name }! You are signed in.
form-has-errors = Please correct the fields marked below.
username-error-too-short = The username is too short.
username-error-too-long = The username is too long (at most 25 characters).
username-error-characters = Use letters, digits, spaces, dots, hyphens and underscores only.
username-error-edges = Spaces, dots, hyphens and underscores can only go between letters or digits, one at a time.
username-error-mixed-scripts = Please use one alphabet: mixing, say, Latin and Cyrillic letters isn’t allowed.
username-error-disallowed = This username is reserved.
username-error-taken = This username, or one that looks just like it, is already taken.
email-error-invalid = This doesn’t look like an e-mail address.
email-error-taken = An account with this e-mail address already exists.
password-error-too-short = The password must be at least 10 characters long.
password-error-too-long = The password is too long.
password-error-same-as-name = The password can’t be your username or e-mail address.
rules-error-required = You need to accept the rules to register.
rules-default =
    Be kind. Disagree with ideas, not with people.

    No spam, advertising or illegal content. Posts that break the rules may be edited or removed by moderators.

    Write in a way others can read: a descriptive topic title helps everyone.

## E-mail verification and password reset
mail-verify-subject = Confirm your e-mail address for { $board }
mail-verify-body =
    Hello { $name },

    someone (hopefully you) registered the account “{ $name }” on { $board } with this e-mail address. To finish, open this link:

    { $link }

    The link works once and for 7 days. If this wasn’t you, ignore this message and the account won’t be activated.
mail-reset-subject = Reset your password on { $board }
mail-reset-body =
    Hello { $name },

    someone (hopefully you) asked to reset the password of the account “{ $name }” on { $board }. To choose a new password, open this link:

    { $link }

    The link works once and for one hour. If this wasn’t you, ignore this message: your password stays as it is.
verify-title = Confirm your e-mail address
verify-sent = Almost there! We’ve sent a link to your e-mail address. Open it to activate your account. It may take a minute to arrive; check your spam folder too.
verify-confirm-text = Confirm the e-mail address of the account “{ $name }” and sign in.
verify-confirm-submit = Confirm and sign in
verify-invalid = This link has expired or has already been used. Sign in to get a new one.
verified-notice = Thanks, { $name }! Your e-mail address is confirmed and you are signed in.
login-error-unverified = Your e-mail address isn’t confirmed yet. Open the link we sent you, or get a new one.
login-resend = Send a new link
login-resent = If that account is waiting for confirmation, we’ve sent a new link to its e-mail address.
login-forgot = Forgot your password?
reset-title = Reset your password
reset-request-text = Enter the e-mail address of your account and we’ll send you a link to choose a new password.
reset-request-submit = Send the link
reset-requested = If an account uses that address, we’ve sent it a link. It works for one hour.
reset-error-throttled = Too many requests from your network. Please try again later.
reset-new-text = Choose a new password for “{ $name }”. You will be signed out everywhere else.
reset-new-password = New password
reset-submit = Save and sign in
reset-invalid = This link has expired or has already been used. You can ask for a new one below.
reset-done-notice = Your password has been changed and you are signed in. Other devices have been signed out.

## Profiles
profile-title = Profile of { $name }
profile-last-seen = Last visit
profile-website = Website
profile-recent-topics = Recent topics
profile-no-topics = No topics to show.

## Polls
poll-results = Poll results
poll-percent = { $percent }%
poll-votes = { $count ->
    [one] { $count } vote
   *[other] { $count } votes
}
poll-total = Total votes: { $count }
poll-hidden = Results are shown when the poll ends.
poll-ends = Ends
poll-ended = Ended

## Posting
posting-new-topic = New topic
posting-reply = Reply
posting-edit = Edit post
posting-delete = Delete post
posting-in-topic = In the topic
posting-title = Topic title
posting-subject = Subject
posting-optional = optional
posting-type = Topic type
posting-type-normal = Normal
posting-type-sticky = Sticky
posting-type-announcement = Announcement
posting-body = Message
posting-toolbar = Formatting
posting-tag-b = Bold
posting-tag-i = Italic
posting-tag-u = Underline
posting-tag-quote = Quote
posting-tag-code = Code
posting-tag-url = Link
posting-tag-img = Image
posting-bbcode-hint = BBCode works: [b]bold[/b], [quote]…[/quote], [url]https://…[/url]. Smilies too.
posting-submit = Post
posting-save = Save
posting-preview = Preview
posting-cancel = Cancel
posting-delete-confirm = Delete this post? Moderators can still see deleted posts.
posting-delete-submit = Delete
posting-quote = Quote
posting-edit-link = Edit
posting-delete-link = Delete
posting-error-sign-in = Sign in to post.
posting-error-not-found = This topic or forum doesn't exist (any more).
posting-error-forbidden = You can't do that here.
posting-error-locked = This topic is locked.
posting-error-flood = You're posting too fast. Try again in { $seconds } s.
posting-error-title-missing = Give the topic a title.
posting-error-title-long = The title is too long (at most 100 characters).
posting-error-body-missing = Write a message.
posting-error-body-long = The message is too long.
posting-error-not-last-post = You can only delete your post while nobody has replied after it.
post-edited = { $count ->
    [one] Edited once, last
   *[other] Edited { $count } times, last
}
topic-locked-hint = This topic is locked: no new replies.
topic-new-replies = { $count ->
    [one] 1 new reply since you opened this page: show it
   *[other] { $count } new replies since you opened this page: show them
}

## Bans
banned-title = You have been banned from this board.
banned-reason = Reason:
email-error-banned = This e-mail address can't be used here.

## Moderation
modcp-title = Moderate topic
modcp-link = Moderate
modcp-reason = Reason
modcp-lock = Lock topic
modcp-unlock = Unlock topic
modcp-move = Move topic
modcp-move-to = Move to
modcp-move-shadow = Leave a "moved" link in the old forum
modcp-merge = Merge into another topic
modcp-merge-target = Topic to merge into (number or link)
modcp-merge-hint = Every post of this topic moves there; this topic's links will lead there too.
modcp-split = Split topic
modcp-split-posts = Posts to move to the new topic
modcp-split-title = Title of the new topic
modcp-split-forum = Forum of the new topic
modcp-delete = Delete topic
modcp-delete-confirm = Yes, delete this topic and all its posts
modcp-error-forbidden = You can't do that in this forum.
modcp-error-not-found = That topic or forum doesn't exist.
modcp-error-same-forum = The topic is already in that forum.
modcp-error-title-missing = Give the new topic a title.
modcp-error-title-long = The title is too long (at most 100 characters).
modcp-error-nothing-selected = Choose some of the posts, but not all of them.
modcp-error-invalid = That didn't work: check the form.

## Package: quick-reply
quick-reply-heading = Quick reply

## Package: reports
edit-policy-admin-post = Only administrators can change an administrator's post.
edit-policy-window-closed = { $minutes ->
    [one] Posts can be changed for 1 minute after posting; ask a moderator.
   *[other] Posts can be changed for { $minutes } minutes after posting; ask a moderator.
}
revisions-link = History
revisions-title = Post history
revisions-back = Back to the post
revisions-current = Current version
revisions-replaced = Replaced on { $when }
revisions-by = edited by { $name }
core-package-error = Something went wrong while checking this. Please try again later.
reports-report = Report
reports-queue = Reports
reports-title = Report a post
reports-reason = What's wrong with this post?
reports-submit = Send to the moderators
reports-sent = Thanks: the moderators have your report.
reports-already = You've already reported this post; the moderators will look at it.
reports-error-reason = Say briefly what's wrong (up to 1000 characters).
reports-queue-title = Open reports
reports-queue-empty = No open reports. All quiet.
reports-by = Reported by { $name }
reports-outcome = Outcome
reports-close = Close report
reports-view-post = View post

## Package: unread-tracking
unread-new = new
unread-mark-forum = Mark forum read
unread-mark-all = Mark all forums read

## Notifications
mail-digest-subject = { $count ->
    [one] New replies in a topic you watch on { $board }
   *[other] New replies in { $count } topics you watch on { $board }
}
mail-digest-topic =
    "{ $topic }": { $count ->
        [one] 1 new reply
       *[other] { $count } new replies
    }
    { $link }
mail-digest-body =
    Hello { $name },

    Here's what happened on { $board } in the topics you watch:

    { $topics }

    You get this digest once a day. To get e-mails right away, or none, change
    "E-mail about replies" in your settings: { $settings }
mail-reply-subject = New reply in "{ $topic }"
mail-reply-body =
    Hello { $name },

    { $author } replied in "{ $topic }" on { $board }:

    { $excerpt }

    Read it: { $link }

    You're watching this topic. You won't get more e-mails about it until you visit it again.
    To stop watching, open the topic and choose "Stop watching": { $unwatch }
mail-pm-subject = New private message on { $board }
mail-pm-body =
    Hello { $name },

    { $from } sent you a private message on { $board }.

    Read it: { $link }

    You can turn these e-mails off in your account settings.
watch-start = Watch this topic
watch-stop = Stop watching

## Private messages
pm-title = Private messages
pm-folders = Folders
pm-inbox = Inbox
pm-sent = Sent
pm-new = New message
pm-sent-notice = Message sent.
pm-empty = No messages here.
pm-subject = Subject
pm-from = From
pm-to = To
pm-date = Date
pm-not-read = not read yet
pm-reply = Reply
pm-delete = Delete
pm-send = Send
pm-header = Messages
pm-error-sign-in = Sign in to send messages.
pm-error-forbidden = You can't send private messages.
pm-error-recipient-unknown = There's no member with that name.
pm-error-inbox-full = Their inbox is full. Try again later.
pm-error-subject-missing = Give the message a subject.
pm-error-subject-long = The subject is too long (at most 100 characters).
pm-error-body-missing = Write a message.
pm-error-body-long = The message is too long.
pm-error-flood = You're sending too fast. Try again in { $seconds } s.
reports-closed-subject = Your report was handled
reports-closed-body = The moderators have looked at the post you reported ({ $link }).{ $outcome }

## Account
account-title = Your account
account-link = Account
account-intro = Signed in as { $name }
account-profile = Profile
account-saved = Saved.
account-signature = Signature
account-signature-now = Your signature now:
account-notifications = Notifications
account-notify-pm = E-mail me when I get a private message
account-auto-watch = Watch the topics I start or reply to
pref-core-replyMail = E-mail about replies in watched topics
pref-core-replyMail-instant = Right away (one e-mail per topic until I visit it)
pref-core-replyMail-daily = Once a day, in one digest
pref-core-replyMail-off = Never
account-password = Change password
account-password-current = Current password
account-password-new = New password
account-password-change = Change password
account-password-saved = Password changed. Other devices have been signed out.
account-error-website = Enter a full link, starting with https://
account-error-signature = The signature is too long (at most { $max } characters).
account-error-current = That's not your current password.

## Search
search-title = Search
search-keywords = Words to find
search-hint = Every word must appear; the start of a word is enough, and accents don't matter.
search-author = Posted by
search-forum = In the forum
search-all-forums = All forums
search-submit = Search
search-found = { $count ->
    [0] Nothing found.
    [one] One post found.
   *[other] { $count } posts found.
}
search-found-more = More than { $count } posts found. Add words or choose a forum to narrow it down.
search-error-terms = Enter at least one word of two or more letters.
search-error-author = There's no member with that name.
search-error-throttled = Too many searches. Try again in { $seconds } s.
members-title = Members
members-name = Username
posting-error-new-member-links = New members can't post links yet. Write a few posts first.
pm-error-new-member = New members can't send private messages yet. Write a few posts first.
register-invite-only = Registration is by invitation only right now. Ask an administrator for an invite link.
register-captcha-checking = Checking that you're a person (a second or two)…
register-error-captcha-missing = The form was incomplete. Please try again.
register-error-captcha-invalid = The form was incomplete. Please try again.
register-error-captcha-expired = The form was open too long. Please send it again.
register-error-captcha-too-fast = That was very fast. Wait a few seconds and send it again.
register-error-captcha-reused = This form was already sent. Please send it again.

## Admin panel
admin-title = Admin panel
admin-nav = Admin sections
admin-link = Admin
admin-overview = Overview
admin-settings = Board settings
admin-forums = Forums
admin-groups = Groups
admin-ranks = Ranks
admin-permissions = Permissions
admin-users = Members
admin-access = Bans and invites
admin-packages = Packages
admin-audit = Audit log
admin-stat-users = Members
admin-stat-forums = Forums
admin-stat-topics = Topics
admin-stat-posts = Posts
admin-stat-bans = Active bans
admin-stat-packages = Packages on
admin-stat-version = Running
admin-mail-log = mail goes to the log
admin-mail-log-warning = E-mail isn't being delivered: set POSTMODEM_MAIL_URL to an smtp:// address so members get confirmation and reset e-mails.
admin-recent = Recent changes
admin-saved = { $count ->
    [0] Nothing changed.
   *[other] Saved.
}
admin-invalid-value = This value isn't allowed.
admin-settings-board = Board
admin-settings-registration = Registration
admin-settings-posting = Posting and limits
setting-core-board-name = Board name
setting-core-board-description = Description
setting-core-board-defaultLocale = Default language
setting-core-urls-style = Link style (classic keeps phpBB2's links)
setting-core-registration-open = Registration is open
setting-core-registration-inviteOnly = Only with an invite link
setting-core-registration-verifyEmail = New members confirm their e-mail address
setting-core-registration-rules = Board rules (shown at registration)
setting-core-registration-rulesVersion = Rules version (raise it when the rules change)
setting-core-registration-disallowedUsernames = Disallowed usernames, one per line (* wildcards)
setting-core-posting-floodSeconds = Seconds between two posts by a member
setting-core-posting-perHour = Posts per member and hour (0: no limit)
setting-core-posting-maxLength = Longest post, in characters
setting-core-newMembers-posts = Posts before members may post links and send messages
setting-core-pm-inboxLimit = Messages an inbox holds
setting-core-search-perMinute = Searches per IP and minute (0: no limit)
setting-core-memberlist-guests = Guests may see the member list
setting-core-notify-digestHour = Hour daily digests go out (0–23, in each member's time zone)
admin-kind = Kind
admin-kind-forum = Forum
admin-kind-category = Category
admin-kind-link = Link
admin-title-field = Title
admin-description = Description
admin-parent = Inside
admin-top-level = (top level)
admin-position = Position (lower first)
admin-locked = Locked (no new posts)
admin-delete-empty = Delete (only when empty)
admin-forums-create = New forum or category
admin-link-url = Link target
admin-create = Create
admin-forums-error-invalid = Check the form: a title is needed.
admin-forums-error-url = A link needs a full address (https://…).
admin-forums-error-parent = That can't contain anything.
admin-forums-error-move = It can't move inside itself.
admin-forums-error-not-empty = Only empty forums can be deleted: move its topics and sub-forums first.
admin-name = Name
admin-group-kind-open = open
admin-group-kind-closed = closed
admin-group-kind-hidden = hidden
admin-group-kind-system = system
admin-group-moderator = group moderator
admin-pending = waiting
admin-remove = Remove
admin-remove-member = Remove { $name } from { $group }
admin-no-members = No members.
admin-add-member = Add a member (username)
admin-add = Add
admin-groups-create = New group
admin-groups-error-invalid = Check the form: a name is needed.
admin-groups-error-exists = A group with that name exists.
admin-groups-error-user = There's no member with that name.
rank-label = Rank
rank-default-owner = Owner
rank-default-admin = Admin
rank-default-mod = Mod
rank-default-vip = VIP user
rank-default-user = User
admin-ranks-intro = A member shows the post-count rank whose minimum they have reached, unless you give them a special rank.
admin-ranks-none = There are no ranks yet.
admin-rank-title = Title
admin-rank-kind = Kind
admin-rank-kind-posts = Reached by post count
admin-rank-kind-special = Special: given to members one by one
admin-rank-min-posts = Minimum posts
admin-rank-min-posts-hint = Only for ranks reached by post count.
admin-rank-image = Image
admin-rank-image-hint = PNG, GIF, JPEG or WebP, at most 256 KB. Leave empty to keep the current one.
admin-rank-remove-image = Remove the image
admin-rank-image-of = Image of the rank { $rank }
admin-rank-from-posts = { $count ->
    [one] from { $count } post
   *[other] from { $count } posts
}
admin-rank-special-members = { $count ->
    [one] special, { $count } member
   *[other] special, { $count } members
}
admin-rank-delete = Delete
admin-rank-edit = Edit
admin-rank-delete-named = Delete the rank { $rank }
admin-rank-create = New rank
admin-rank-assign = Give a member a special rank
admin-rank-assign-user = Member (username)
admin-rank-assign-rank = Rank
admin-rank-assign-none = No special rank (by post count)
admin-rank-assign-submit = Give rank
admin-rank-assigned = { $name } now has the rank { $rank }.
admin-rank-unassigned = { $name } now has the rank of their post count.
admin-rank-error-title = Enter a title of at most 50 characters.
admin-rank-error-minPosts = Enter a minimum number of posts (0 or more).
admin-rank-error-image-empty = The image file is empty.
admin-rank-error-image-large = The image is larger than 256 KB.
admin-rank-error-image-type = The image must be a PNG, GIF, JPEG or WebP file.
admin-rank-error-missing = That rank no longer exists.
admin-rank-error-user = There's no member with that name.
admin-rank-error-rank = Choose a special rank.
admin-simulator = Check a permission
admin-sim-who = Who (username, or guest)
admin-sim-hint = Shows whether they may, and which grants decided it.
admin-sim-capability = May they…
admin-sim-where = Where
admin-board-wide = Whole board
admin-sim-check = Check
admin-sim-allowed = Allowed
admin-sim-denied = Not allowed
admin-grants = Grants: who has which role, where
admin-subject = Who
admin-role = Role
admin-revoke-grant = Remove { $role } from { $subject }
admin-grant-add = Give a role
admin-subject-group = a group
admin-subject-user = a member
admin-permissions-error-invalid = Check the form.
admin-permissions-error-user = There's no member with that name.
admin-permissions-error-last-admin = That's the last board-wide administrator: give the role to someone else first.
admin-users-find = Find a member (exact name or e-mail address)
admin-user-done = Done: { $name }.
admin-users-error-user = No such member, or not possible for this account.
admin-users-error-self = You can't ban yourself.
admin-status-active = active
admin-status-pending = waiting for e-mail confirmation
admin-status-banned = banned (imported)
admin-status-deleted = deleted
admin-banned = banned
admin-no-email = no e-mail address
admin-unban = Lift ban
admin-ban = Ban
admin-ban-days = For days (0: for good)
admin-activate = Activate
admin-force-reset = Force a password reset
admin-bans = Bans
admin-until = until { $date }
admin-remove-ban = Remove the ban on { $value }
admin-no-bans = No bans.
admin-ban-add = Ban an IP or e-mail address
admin-ban-pattern = Address or pattern
admin-ban-pattern-hint = * stands for anything: 192.168.*, *@spam.example
admin-access-error-pattern = That isn't a valid IP or e-mail pattern.
admin-invites = Invites
admin-invite-created = Invite link (shown only now, copy it):
admin-invite-uses = { $count ->
    [one] one use left
   *[other] { $count } uses left
}
admin-expired = expired
admin-revoke-invite = Remove invite { $id }
admin-no-invites = No invites.
admin-invite-create = New invite link
admin-invite-uses-field = How many registrations
admin-invite-days = Valid for days
admin-note = Note (for you)
admin-packages-profile = Profile: { $profile }.
admin-packages-follows = Until you change something here, the enabled set follows it.
admin-packages-enabled = Enabled packages
admin-packages-privacy-unavailable = Privacy handlers did not start. Account export and deletion are blocked until this package is repaired.
admin-actor = Who
admin-action = What
admin-target = On what
admin-system = system

## Privacy and your data
deleted-user = Deleted user
account-deleted-notice = Your account has been deleted. Thank you for having been here.
account-data = Your data
account-data-intro = Download everything this board holds about you: your profile, posts and private messages.
account-export = Download my data (JSON)
account-delete = Delete my account
account-delete-keeps-posts = Your profile, e-mail address, password, private messages and settings are erased. Your posts stay, as "Deleted user", so threads keep making sense. This can't be undone.
account-delete-removes-posts = Your profile, e-mail address, password, private messages, settings and posts are erased. This can't be undone.
account-delete-confirm = Yes, delete my account for good
account-delete-confirm-required = Tick the box to confirm.
account-delete-submit = Delete my account
privacy-title = Privacy
privacy-link = Privacy
setting-core-board-privacy = Privacy notice (empty: the built-in one)
setting-core-accounts-deletedPosts = A deleted member's posts (keep: as "Deleted user")
privacy-default =
    { $board } runs Postmodem. This page says what it stores about you and why.

    When you register: your username, e-mail address, a hash of your password (never the password itself), when you joined and when you last visited, and the version of the board rules you accepted. Your e-mail address is used for confirming it, resetting your password and the notifications you choose; it isn't shown to other members.

    What you write: posts, private messages and your profile fields. Posts are public in the forums you post in; private messages only to you and the other member.

    Cookies: one session cookie when you sign in, and two for your language and theme if you choose them. No tracking, no advertising, no third-party scripts.

    Sessions remember the kind of browser you use, so you can see where you're signed in. Moderators may keep a record of moderation actions with their reasons.

    You can download everything about you and delete your account in your account settings. Deleting it erases your profile, e-mail address, password, private messages and settings; your posts stay under "Deleted user" unless this board removes them.
register-privacy = What we store about you, and why:

password-error-package-min-length = This password is shorter than the board’s minimum length.
password-error-letters-and-numbers = Use at least one letter and one number.
password-error-policy-unavailable = The board couldn’t check your new password. Try again later.
account-email-title = Change e-mail address
account-email-help = Your current address stays active until you confirm the new one.
account-email-new = New e-mail address
account-email-send = Send confirmation link
account-email-sent = We sent a confirmation link to your new address.
account-email-confirm = Confirm e-mail change
account-email-confirm-text = Change your account e-mail address to { $email }?
account-email-changed = Your e-mail address was changed.
email-error-throttled = Too many requests. Try again later.
mail-change-email-subject = Confirm your e-mail change on { $board }
mail-change-email-body =
    Hello { $name },

    Open this link and sign in to confirm your new e-mail address:

    { $link }

    If you did not request this change, you can ignore this message.

admin-trash-destination = Trash destination
admin-trash-disabled = No trash destination
admin-forums-error-trash-destination = Choose a different forum for the trash destination.
admin-trash-view = Trashed topics
admin-trash-restored = Topic restored.
admin-trash-restore-error = The topic could not be restored.
admin-trash-empty = This forum has no trashed topics.
admin-trash-restore-to = Restore “{ $title }” to
admin-trash-pick-forum = Choose a forum
admin-trash-restore = Restore topic

ip-logging-title = IP history
ip-logging-address = IP address
ip-logging-event = Event
ip-logging-time = Time (UTC)
ip-logging-kind-sign-in = Sign-in
ip-logging-kind-post = Post
ip-logging-kind-legacy = Imported record
ip-logging-empty = No recent IP records.
ip-logging-purpose = When IP logging is enabled, the board records IP addresses for member sign-ins and posts to support moderation. Recorded and imported addresses expire after { $days } days and are visible to authorized administrators.
