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
account-notifications = E-mail me
account-notify-pm = when I get a private message
account-auto-watch = about replies in topics I start or reply to
account-password = Change password
account-password-current = Current password
account-password-new = New password
account-password-change = Change password
account-password-saved = Password changed. Other devices have been signed out.
account-error-website = Enter a full link, starting with https://
account-error-signature = The signature is too long (at most { $max } characters).
account-error-current = That's not your current password.
