import { describe, expect, it } from "vitest";
import {
  addProjectMember,
  memberId,
  newProjectGroup,
  removeProjectMember,
  renameProjectGroup,
  renameProjectMember,
} from "./projectGroups";

describe("project groups", () => {
  it("adds and updates a stable port membership", () => {
    const group = newProjectGroup("MeteorPanel");
    const first = addProjectMember([group], group.id, {
      label: "Frontend",
      protocol: "TCP",
      port: 4200,
    });
    const updated = addProjectMember(first, group.id, {
      label: "Angular UI",
      protocol: "TCP",
      port: 4200,
    });

    expect(updated[0].members).toHaveLength(1);
    expect(updated[0].members[0]).toMatchObject({
      id: "TCP:4200",
      label: "Angular UI",
    });
  });

  it("renames and removes project entries", () => {
    const group = newProjectGroup(" Meteor   Panel ");
    const withMember = addProjectMember([group], group.id, {
      label: "Backend",
      protocol: "TCP",
      port: 8080,
    });
    const renamed = renameProjectMember(
      renameProjectGroup(withMember, group.id, "MeteorPanel"),
      group.id,
      memberId("TCP", 8080),
      "API",
    );
    const removed = removeProjectMember(
      renamed,
      group.id,
      memberId("TCP", 8080),
    );

    expect(renamed[0].name).toBe("MeteorPanel");
    expect(renamed[0].members[0].label).toBe("API");
    expect(removed[0].members).toHaveLength(0);
  });
});
