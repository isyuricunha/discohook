import {
  APIActionRowComponent,
  APIButtonComponent,
  APIChannelSelectComponent,
  APIMentionableSelectComponent,
  APIMessageActionRowComponent,
  APIMessageComponent,
  APIRoleSelectComponent,
  APIStringSelectComponent,
  APITextInputComponent,
  APIUserSelectComponent,
  ButtonStyle,
  ComponentType,
} from "discord-api-types/v10";
import LocalizedStrings from "react-localization";
import { QueryData } from "~/types/QueryData";
import { Button } from "../Button";
import { ButtonSelect } from "../ButtonSelect";
import { Checkbox } from "../Checkbox";
import { CoolIcon } from "../CoolIcon";
import { selectStrings } from "../StringSelect";
import { TextInput } from "../TextInput";
import { CUSTOM_EMOJI_RE, EMOJI_NAME_RE } from "../preview/Markdown";

export const getComponentText = (
  component: APIMessageComponent
): string | undefined =>
  component.type === ComponentType.Button
    ? component.label ?? component.emoji?.name
    : component.type === ComponentType.StringSelect
    ? component.placeholder
    : undefined;

export const getComponentWidth = (component: {
  type: ComponentType;
}): number => {
  switch (component.type) {
    case ComponentType.Button:
      return 1;
    case ComponentType.StringSelect:
    case ComponentType.UserSelect:
    case ComponentType.RoleSelect:
    case ComponentType.MentionableSelect:
    case ComponentType.ChannelSelect:
    case ComponentType.TextInput:
      return 5;
    default:
      break;
  }
  return 0;
};

export const getRowWidth = (
  row: APIActionRowComponent<
    | APIButtonComponent
    | APIStringSelectComponent
    | APIUserSelectComponent
    | APIRoleSelectComponent
    | APIMentionableSelectComponent
    | APIChannelSelectComponent
    | APITextInputComponent
  >
): number => {
  return row.components.reduce(
    (last, component) => getComponentWidth(component) + last,
    0
  );
};

const strings = new LocalizedStrings({
  en: {
    rowEmpty: "Must contain at least one component (button/select)",
    labelEmpty: "Must have a label or emoji, or both",
    urlEmpty: "Link button must have a URL",
    optionsEmpty: "Must contain at least one select option",
  },
});

export const getComponentErrors = (
  component: APIMessageComponent
): string[] => {
  let errors: string[] = [];
  switch (component.type) {
    case ComponentType.ActionRow:
      if (component.components.length === 0) {
        errors.push(strings.rowEmpty);
      }
      // if (component.components.length > 5) {
      //   errors.push("Cannot contain more than five components")
      // }
      break;
    case ComponentType.Button:
      if (!component.emoji && !component.label) {
        errors.push(strings.labelEmpty);
      }
      if (component.style === ButtonStyle.Link && !component.url) {
        errors.push(strings.urlEmpty);
      }
      break;
    case ComponentType.StringSelect:
      if (component.options.length === 0) {
        errors.push(strings.optionsEmpty);
      }
    default:
      break;
  }
  return errors;
};

export const ActionRowEditor: React.FC<{
  message: QueryData["messages"][number];
  row: APIActionRowComponent<APIMessageActionRowComponent>;
  rowIndex: number;
  data: QueryData;
  setData: React.Dispatch<React.SetStateAction<QueryData>>;
  open?: boolean;
}> = ({ message, row, rowIndex: i, data, setData, open }) => {
  const errors = getComponentErrors(row);
  return (
    <details className="group/action-row" open={open}>
      <summary className="group-open/action-row:mb-2 transition-[margin] marker:content-none marker-none flex text-base text-gray-600 dark:text-gray-400 font-semibold cursor-default select-none">
        <CoolIcon
          icon="Chevron_Right"
          className="group-open/action-row:rotate-90 mr-2 my-auto transition-transform"
        />
        Row {i + 1}
        <div className="ml-auto text-xl space-x-2.5 my-auto shrink-0">
          <button
            className={i === 0 ? "hidden" : ""}
            onClick={() => {
              message.data.components!.splice(i, 1);
              message.data.components!.splice(i - 1, 0, row);
              setData({ ...data });
            }}
          >
            <CoolIcon icon="Chevron_Up" />
          </button>
          <button
            className={
              i === message.data.components!.length - 1 ? "hidden" : ""
            }
            onClick={() => {
              message.data.components!.splice(i, 1);
              message.data.components!.splice(i + 1, 0, row);
              setData({ ...data });
            }}
          >
            <CoolIcon icon="Chevron_Down" />
          </button>
          <button
            className={
              message.data.components!.length - 1 + 1 >= 5 ? "hidden" : ""
            }
            onClick={() => {
              message.data.components!.splice(i + 1, 0, row);
              setData({ ...data });
            }}
          >
            <CoolIcon icon="Copy" />
          </button>
          <button
            onClick={() => {
              message.data.components!.splice(i, 1);
              setData({ ...data });
            }}
          >
            <CoolIcon icon="Trash_Full" />
          </button>
        </div>
      </summary>
      {errors.length > 0 && (
        <p className="-mt-1 mb-1 text-sm font-regular p-2 rounded bg-rose-300 border-2 border-rose-400 dark:border-rose-300 dark:text-black select-none">
          {errors.map((e) => (
            <span className="block" key={`row-error-${e}`}>
              <CoolIcon icon="Circle_Warning" /> {e}
            </span>
          ))}
        </p>
      )}
      <div className="ml-2 md:ml-4">
        {row.components.map((component, ci) => (
          <IndividualComponentEditor
            key={`edit-message-${i}-row-${i}-component-${component.type}-${ci}`}
            component={component}
            index={ci}
            row={row}
            updateRow={() => setData({ ...data })}
            open={component.type !== ComponentType.Button}
          >
            {component.type === ComponentType.Button ? (
              <>
                <div className="flex">
                  <div className="grow">
                    <TextInput
                      label="Label"
                      className="w-full"
                      value={component.label ?? ""}
                      onInput={(e) => {
                        component.label = e.currentTarget.value;
                        setData({ ...data });
                      }}
                      maxLength={80}
                    />
                  </div>
                  <div className="ml-2 my-auto">
                    <Checkbox
                      label="Disabled"
                      checked={component.disabled ?? false}
                      onChange={(e) => {
                        component.disabled = e.currentTarget.checked;
                        setData({ ...data });
                      }}
                    />
                  </div>
                </div>
                <TextInput
                  label="Emoji"
                  className="w-full"
                  value={
                    component.emoji?.id
                      ? `<${component.emoji.animated ? "a" : ""}:${
                          component.emoji.name
                        }:${component.emoji.id}>`
                      : component.emoji?.name ?? ""
                  }
                  onInput={(e) => {
                    const { value } = e.currentTarget;
                    if (!value) {
                      component.emoji = undefined;
                      setData({ ...data });
                      return;
                    }
                    const customMatch = value.match(CUSTOM_EMOJI_RE),
                      stockMatch = value.match(EMOJI_NAME_RE);
                    if (customMatch) {
                      component.emoji = {
                        id: customMatch[3],
                        name: customMatch[2],
                        animated: customMatch[1] === "a",
                      };
                      setData({ ...data });
                    }
                    // else if (stockMatch) {
                    //   component.emoji = {
                    //     name: stockMatch[1],
                    //   }
                    // }
                  }}
                />
                {component.style === ButtonStyle.Link ? (
                  <TextInput
                    label="URL"
                    type="url"
                    className="w-full"
                    value={component.url}
                    onInput={(e) => {
                      component.url = e.currentTarget.value;
                      setData({ ...data });
                    }}
                  />
                ) : (
                  <div>
                    <p className="text-sm font-medium cursor-default">Style</p>
                    <div className="grid gap-1 grid-cols-4">
                      <Button
                        className="block min-h-0 h-7 !p-0"
                        discordstyle={ButtonStyle.Primary}
                        onClick={() => {
                          component.style = ButtonStyle.Primary;
                          setData({ ...data });
                        }}
                      />
                      <Button
                        className="block min-h-0 h-7 !p-0"
                        discordstyle={ButtonStyle.Secondary}
                        onClick={() => {
                          component.style = ButtonStyle.Secondary;
                          setData({ ...data });
                        }}
                      />
                      <Button
                        className="block min-h-0 h-7 !p-0"
                        discordstyle={ButtonStyle.Success}
                        onClick={() => {
                          component.style = ButtonStyle.Success;
                          setData({ ...data });
                        }}
                      />
                      <Button
                        className="block min-h-0 h-7 !p-0"
                        discordstyle={ButtonStyle.Danger}
                        onClick={() => {
                          component.style = ButtonStyle.Danger;
                          setData({ ...data });
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              [
                ComponentType.StringSelect,
                ComponentType.UserSelect,
                ComponentType.RoleSelect,
                ComponentType.MentionableSelect,
                ComponentType.ChannelSelect,
              ].includes(component.type) && (
                <>
                  <div className="flex">
                    <div className="grow">
                      <TextInput
                        label="Placeholder"
                        value={component.placeholder ?? ""}
                        placeholder={selectStrings.defaultPlaceholder}
                        maxLength={150}
                        className="w-full"
                        onInput={(e) => {
                          component.placeholder = e.currentTarget.value;
                          setData({ ...data });
                        }}
                      />
                    </div>
                    <div className="ml-2 my-auto">
                      <Checkbox
                        label="Disabled"
                        checked={component.disabled ?? false}
                        onChange={(e) => {
                          component.disabled = e.currentTarget.checked;
                          setData({ ...data });
                        }}
                      />
                    </div>
                  </div>
                </>
              )
            )}
          </IndividualComponentEditor>
        ))}
      </div>
      <ButtonSelect
        name="component-type"
        options={[
          {
            label: "Button",
            value: "button",
            isDisabled: getRowWidth(row) >= 5,
          },
          {
            label: "Link Button",
            value: "link-button",
            isDisabled: getRowWidth(row) >= 5,
          },
          {
            label: "String Select Menu",
            value: "string-select",
            isDisabled: getRowWidth(row) > 0,
          },
          {
            label: "User Select Menu",
            value: "user-select",
            isDisabled: getRowWidth(row) > 0,
          },
          {
            label: "Role Select Menu",
            value: "role-select",
            isDisabled: getRowWidth(row) > 0,
          },
          {
            label: "User & Role Select Menu",
            value: "mentionable-select",
            isDisabled: getRowWidth(row) > 0,
          },
          {
            label: "Channel Select Menu",
            value: "channel-select",
            isDisabled: getRowWidth(row) > 0,
          },
        ]}
        isDisabled={getRowWidth(row) >= 5}
        onChange={(v) => {
          const { value: type } = v as { value: string };
          switch (type) {
            case "button": {
              row.components.push({
                type: ComponentType.Button,
                style: ButtonStyle.Primary,
                custom_id: "",
              });
              break;
            }
            case "link-button": {
              row.components.push({
                type: ComponentType.Button,
                style: ButtonStyle.Link,
                url: "",
              });
              break;
            }
            case "string-select": {
              row.components.push({
                type: ComponentType.StringSelect,
                options: [],
                custom_id: "",
              });
              break;
            }
            case "user-select": {
              row.components.push({
                custom_id: "",
                type: ComponentType.UserSelect,
              });
              break;
            }
            case "role-select": {
              row.components.push({
                custom_id: "",
                type: ComponentType.RoleSelect,
              });
              break;
            }
            case "mentionable-select": {
              row.components.push({
                custom_id: "",
                type: ComponentType.MentionableSelect,
              });
              break;
            }
            case "channel-select": {
              row.components.push({
                custom_id: "",
                type: ComponentType.ChannelSelect,
              });
              break;
            }
            default:
              break;
          }
          setData({ ...data });
        }}
      >
        Add Component
      </ButtonSelect>
    </details>
  );
};

export const IndividualComponentEditor: React.FC<
  React.PropsWithChildren<{
    component: APIMessageActionRowComponent;
    index: number;
    row: APIActionRowComponent<APIMessageActionRowComponent>;
    updateRow: () => void;
    open?: boolean;
  }>
> = ({ component, index, row, updateRow, open, children }) => {
  const previewText = getComponentText(component);
  return (
    <details className="group/component pb-2 -my-1" open={open}>
      <summary className="group-open/component:mb-2 transition-[margin] marker:content-none marker-none flex text-base text-gray-600 dark:text-gray-400 font-semibold cursor-default select-none">
        <CoolIcon
          icon="Chevron_Right"
          className="group-open/component:rotate-90 mr-2 my-auto transition-transform"
        />
        <span className="shrink-0">
          {component.type === ComponentType.Button
            ? `Button ${index + 1}`
            : "Select Menu"}
        </span>
        {previewText && <span className="truncate ml-1">- {previewText}</span>}
        <div className="ml-auto text-lg space-x-2.5 my-auto shrink-0">
          <button
            className={index === 0 ? "hidden" : ""}
            onClick={() => {
              row.components.splice(index, 1);
              row.components.splice(index - 1, 0, component);
              updateRow();
            }}
          >
            <CoolIcon icon="Chevron_Up" />
          </button>
          <button
            className={index === row.components.length - 1 ? "hidden" : ""}
            onClick={() => {
              row.components.splice(index, 1);
              row.components.splice(index + 1, 0, component);
              updateRow();
            }}
          >
            <CoolIcon icon="Chevron_Down" />
          </button>
          <button
            className={getRowWidth(row) >= 5 ? "hidden" : ""}
            onClick={() => {
              row.components.splice(index + 1, 0, component);
              updateRow();
            }}
          >
            <CoolIcon icon="Copy" />
          </button>
          <button
            onClick={() => {
              row.components.splice(index, 1);
              updateRow();
            }}
          >
            <CoolIcon icon="Trash_Full" />
          </button>
        </div>
      </summary>
      <div className="space-y-2 mb-2">{children}</div>
    </details>
  );
};