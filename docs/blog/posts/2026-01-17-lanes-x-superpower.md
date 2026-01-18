---
title: "Lanes X Superpower"
date: 2026-01-17
tags: [tutorial, workflows]
excerpt: "Learn how to use Lanes' structured workflow system with the Superpowers skills plugin to guide AI agents through complex tasks."
---

## Introduction
When I first discovered the **Superpowers** plugin, I viewed it as a **Lanes** competitor. It provides users with skills that must be executed in a specific order to harness **Claude** and deliver consistent results—something **Lanes** also **tries** to achieve with **its** workflows feature. But quickly, I realised that **Superpowers** does not **compete** with **Lanes**; it **synergises** with it perfectly.

The creators describe it as: _"A complete software development workflow for your coding agents..."_ However, it is up to the user to ensure they follow each step manually. This can be repetitive and prone to error due to adherence issues—something **Lanes** can easily solve. Additionally, Superpowers lacks the session management functionality that **Lanes** provides.

So, I came up with **Lanes x Superpowers**: using **Lanes'** session management functionality with **Superpowers'** skills. Marrying the to two means you get:
* Strict workflow adherence using Lane's workflow management
* Superpowers brainstorming and planning skills, these are excellently design to ensure correct scoping and implementation adherence with design and implementation plans which act as a harness for the agentic implementation
* Lanes session management, everything runs in a worktree by default.
* Lanes chime feature, superpowers approach leads to a lot of back and forth with the user during planning steps. The chime feature means you can let it run in the background and be notified when claude has asked you a question. Freeing you up to focus on other work.

I decided this is something I definitely wanted to try, and since I was thinking of starting a blog I thought addings a blogging feature to Lanes would be a great project to try this on. So yes, this is a blog about how I created a blog :D.

## Setup
Superpowers was very easy to setup, I followed their readme and ran the following in claude
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Then I had to enable Superpowers in my `settings.local.json` file. Lanes will make sure that your local settings file is copied into each of your worktrees, so you do not need to worry about untracked changes which you have defined in local files!

I then had to define the Superpowers workflow, this was easy because Superpowers have a suggested workflow in their README. I kept the instructions in each workflow step very simple as I wanted to make sure to not conflict with any instructions in the skills, this means I also did not use an loops or agents in my workflow as Superpowers should manage this.

```
name: superpower
description: Standard starting workflow recommended by the Superpowers team

steps:
- id: brainstorming
  type: action
  instructions: |
  In this step you will scope out the feature.
  Use the "/brainstorming" skill from Superpowers to start

- id: writing-plans
  type: action
  instructions: |
  In this step you will plan out the features based on the
  brainstorming you just did.
  Use the "/writing-plans" skill from Superpowers to start

- id: subagent-driven-development
  type: action
  instructions: |
  Here is where you will do the implementations.
  Use the "/subagent-driven-development" skill from Superpowers to start

- id: finishing-a-development-branch
  type: action
  instructions: |
  Finalize the implementation:
  Use the "finishing-a-development-branch " skill from Superpowers to start
```

I left my starting prompt to be super basic, as I wanted the brainstorming feature of Superpowers to do it's job in defining the scope of the work.
```
I think the lanes website could use a blog. This can showcase projects    
created by lanes or other lanes related content.

It would need to support variable text, images etc.       
```

## Performance
Both Lanes and Superpowers performed flawlessly in this experiment. Superpowers' brainstorming feature asked some key questions in order to correctly scope the project. These include questions like: 
* **Where should blog posts be authored and stored?** I told it I wanted to write my blogs in markdown (a format I am comfortable with).
* **How should the blog be built?** This question was less great tbh, it provided 3 approaches but did not specify the pros and cons of each. But I was able to ask it for more information where it then did provide that context. I went with 'Simple script + HTML'
* **What features are essential for v1?** I selected answer: Tags/Categories, Reading time. None of these were actually essential but I went with it as it was a suggestion.
* **Which architecture approach do you prefer?** Again it did not provide pros and cons so I was left a bit confusions. But after a follow up I made a decision.

After brainstorming the last step of brainstorming is asking the super to approve the plan by going through it in sections. This is very detailed and verbose, I do like how it tells you edge cases it will handle ahead of time, that was very useful context. For the most part the plan was great and I approved 5/6 sections without any feedback.

The implementation step went smoothly without any need to interrupt the user. The plan was adheared to well, no review steps were missed and issues were found and resolved as expected. Below is a table showing the breakdown of the tasks and their usage.

| **Task**    | **Description**           | **Duration** | **Subagent Context Used** | **Complexity Notes**                                 |
| ----------- | ------------------------- | ------------ | ------------------------- | ---------------------------------------------------- |
| **Task 1**  | Blog Directory Structure  | ~1m 00s      | ~26.9k tokens             | Smooth execution (Implement + 2 Reviews)             |
| **Task 2**  | Package.json Setup        | ~1m 05s      | ~29.3k tokens             | Smooth execution                                     |
| **Task 3**  | Build Script Core         | ~5m 58s      | ~66.4k tokens             | Required code quality fixes & re-review              |
| **Task 4**  | HTML Templates            | ~2m 06s      | ~112.3k tokens            | **High Context:** XSS vulnerability fix required     |
| **Task 5**  | Blog Index Generator      | ~12m 56s     | ~172.6k tokens            | **Highest Load:** Complex logic + Critical XSS fixes |
| **Task 6**  | RSS Feed Generator        | ~2m 10s      | ~58.1k tokens             | Smooth execution                                     |
| **Task 7**  | Main Build Wiring         | ~5m 09s      | ~97.8k tokens             | Required directory creation fix                      |
| **Task 8**  | Navigation Update         | ~0m 54s      | ~63.7k tokens             | Smooth execution                                     |
| **Task 9**  | Example Post 1 (Welcome)  | ~1m 48s      | ~52.0k tokens             | Smooth execution                                     |
| **Task 10** | Example Post 2 (Project)  | ~0m 47s      | ~29.1k tokens             | Fastest task                                         |
| **Task 11** | Example Post 3 (Tutorial) | ~3m 09s      | ~33.8k tokens             | Smooth execution                                     |
| **Task 12** | Final Testing             | ~3m 28s      | ~115.1k tokens            | Large context due to full suite verification         |

The main agent used 87% of its context during the running of the complete workflow, breakdown below. 70-80k tokens were used for subagent management, this means creating the prompts for the subagents and processing their responses and general back and forth between the agent and subagent. This is a huge amount of the main window, but it is a lot less than would be needed if the main agent were to do all the work (Task 7 on its own used 98k of subagent tokens). This means that the blog implementation used 987k tokens to complete. If I were paying per token and used claude-sonnet it would have cost me about $10, I think this is a fair amount for the feature.

```
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛁   glm-4.7 · 130k/200k tokens (65%)
⛀ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   ⛁ System prompt: 2.7k tokens (1.4%)
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   ⛁ System tools: 13.8k tokens (6.9%)
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   ⛁ Custom agents: 490 tokens (0.2%)
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   ⛁ Memory files: 1.9k tokens (0.9%)
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   ⛁ Skills: 674 tokens (0.3%)
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛶ ⛶ ⛶ ⛶   ⛁ Messages: 110.7k tokens (55.3%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝   ⛶ Free space: 25k (12.4%)
⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝   ⛝ Autocompact buffer: 45.0k tokens (22.5%)
⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ 
```

While the total cost is fair and the 12-task breakdown successfully ensured high code quality and identified critical security vulnerabilities that might have otherwise been missed, looking through the tasks I found that the process was excessively granular and resource-intensive for a relatively straightforward feature. The strict implementation workflow managed by Superpowers, requiring multiple reviews for even trivial tasks resulted in significant overhead. A more efficient approach would have consolidated the work into five batched tasks (such as combining setup, build logic, and content creation), which would have maintained the benefits of fresh context and quality gates while eliminating the inefficiency of applying complex subagent workflows to simple boilerplate components.

## Conclusion
I believe the experiment was a great success, evidenced by the fact that you are reading this right now. I plan to keep using **Superpowers** in combination with **Lanes**, specifically the brainstorming skill. While greater synergy could be created to guide the write-plan and subagent-driven development sections (optimising based on task complexity), I am happy with the out-of-the-box support. I also **learned** a lot from **Superpowers**; their skills are detailed yet concise—a perfect example of prompt engineering. They also utilise hooks to ensure safe session restarts, something I plan to implement in **Lanes** to ensure workflows survive restarts.

## Environment
* Claude Code Version: 2.1.5
* Model: GLM 4.7 (zAI Max Plan)
* Superpowers Version: 4.0.3
* Lanes Version: 1.0.4