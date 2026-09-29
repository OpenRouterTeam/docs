# Committed secrets env

## Summary {toggle="true"}
	- API keys were accidentally committed due to an env copy script creating a dev env file
	- Potential exposure was limited to GitHub and Graphite staff for 90 minutes
	- Quick remedies included purging the file from local git tree and contacting GitHub to delete the PR and associated commits
	- Action item: Implement a githook to prevent adding diffs containing secrets

---
## Symptoms
- Keys were visible in a stack/commit
## Root causes
- env copy script created a stray dev env file
- gt added the wrong env file
	- why? — the generated env file used a diff naming convention (dev.env instead of .env.\*)
## Damages
- Potential exposure of API keys to GitHub’s staff and Graphite’s staff for 90 minutes

## Quick remedies
- Used BFG to purge the file from local git tree
	- [How to delete sensitive data from Git](https://graphite.dev/guides/how-to-delete-sensitive-data-from-git#using-bfg-repo-cleaner)
	- [Removing sensitive data from a repository - GitHub Docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository#using-the-bfg)
	```bash
brew install bfg

bfg --delete-files .dev.env
	```

		- Contacted GitHub to delete the PR and any commits associated with it
			- They deleted it promptly, which also removed all traces of the problematic commit on graphite
				[image]

		[image]
		[image]

## Action items
- Need a githook (preferably sharable), maybe a graphite add hook, that prevents adding diff containing secret

---
